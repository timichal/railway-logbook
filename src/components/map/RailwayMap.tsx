"use client";

import type { MapLibreEvent } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SelectionSummaryBar from "@/components/logbook/SelectionSummaryBar";
import UserSidebar, { type ActiveTab } from "@/components/logbook/UserSidebar";
import MapProgressBox from "@/components/map/MapProgressBox";
import MapStationSearch from "@/components/map/MapStationSearch";
import MobileBottomSheet from "@/components/ui/MobileBottomSheet";
import type { User } from "@/lib/authActions";
import { createDataAccess, type DataAccess } from "@/lib/dataAccess";
import * as localStore from "@/lib/localStorage";
import {
  createPublicNotesSource,
  createPublicStationsSource,
  createRailwayRoutesSource,
  createScenicLinesSource,
} from "@/lib/map";
import { fitCamera } from "@/lib/map/fitCamera";
import { useCoverageOverlay } from "@/lib/map/hooks/useCoverageOverlay";
import { useLayerFilters } from "@/lib/map/hooks/useLayerFilters";
import { useLocalRouteFeatureStates } from "@/lib/map/hooks/useLocalRouteFeatureStates";
import { useMapLibre } from "@/lib/map/hooks/useMapLibre";
import { useMapTileRefresh } from "@/lib/map/hooks/useMapTileRefresh";
import { useRouteEditor } from "@/lib/map/hooks/useRouteEditor";
import { useRouteHighlighting } from "@/lib/map/hooks/useRouteHighlighting";
import { useUserMapInteractions } from "@/lib/map/hooks/useUserMapInteractions";
import { useLayerPrefs } from "@/lib/map/layerPrefsContext";
import { useRegion } from "@/lib/regionContext";
import { NEW_JOURNEY_FORM_ID } from "@/lib/selectedRoutes";
import { createUserMapLayers } from "@/lib/shared/map/userMapLayers";
import { regionCountryCodes } from "@/lib/shared/regions";
import type {
  HighlightKind,
  HighlightRoutesFn,
  JourneyEditStartFn,
  PartialRouteGeometry,
  PlannerRoute,
  RouteBounds,
  SelectedRoute,
  Station,
} from "@/lib/shared/types";
import { useResolvedTheme } from "@/lib/theme";
import { useToast } from "@/lib/toast";
import { getRoutesBounds } from "@/lib/userActions";

/** One highlight set: whole routes by id, plus the stretches of those covered only in part. */
interface HighlightSet {
  ids: number[];
  partials: PartialRouteGeometry[];
}

const EMPTY_HIGHLIGHT: HighlightSet = { ids: [], partials: [] };
const NO_HIGHLIGHTS: Record<HighlightKind, HighlightSet> = {
  planner: EMPTY_HIGHLIGHT,
  view: EMPTY_HIGHLIGHT,
};
const NO_SELECTED_ROUTES: SelectedRoute[] = [];

/** Whose highlights each tab shows. */
const TAB_HIGHLIGHT_KIND: Record<ActiveTab, HighlightKind | null> = {
  routes: "planner",
  journeylog: "view",
  filter: null,
};

/** One user's country filter saves: at most one running, the newest list waiting. */
interface CountrySaveQueue {
  userId: number | null;
  dataAccess: DataAccess;
  running: boolean;
  pending: string[] | null;
}

interface RailwayMapProps {
  className?: string;
  user: User | null;
  initialSelectedCountries: string[];
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  sidebarWidth: number;
  onSidebarResize: () => void;
  isResizing: boolean;
  isMobile: boolean;
}

/**
 * Below this much uncovered map the pane cannot carry its own top furniture. At the
 * mobile sheet's topmost snap the map shows as a ~40px strip: the station search and
 * MapLibre's top-right control stack no longer fit in it and would be cut off by the
 * sheet's top edge, so they stand down until there is room again. The bottom-corner
 * furniture is left alone: it rides above the sheet (`--sheet-visible`, globals.css)
 * and the attribution has to stay visible.
 */
const MAP_FURNITURE_MIN_HEIGHT_PX = 180;

export default function RailwayMap({
  className = "",
  user,
  initialSelectedCountries,
  activeTab,
  setActiveTab,
  sidebarWidth,
  onSidebarResize,
  isResizing,
  isMobile,
}: RailwayMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapPane = useRef<HTMLDivElement>(null);
  const [furnitureFits, setFurnitureFits] = useState(true);

  const userId = user?.id || null;
  const region = useRegion();
  const layerPrefs = useLayerPrefs();
  const dataAccess = useMemo(() => createDataAccess(user, region.id), [user, region.id]);
  const { showError } = useToast();

  // Country filter state
  const [selectedCountries, setSelectedCountries] = useState<string[]>(initialSelectedCountries);

  // The country list everything on the map actually filters by. A region the
  // user can't filter by country (Japan, one country) pins it to its own list,
  // which is what keeps the other region's routes, stats and ridden stretches
  // out of this view - the country filter was already doing that job for the
  // European countries, and the regions just happen to be disjoint sets of it.
  const effectiveCountries = useMemo(
    () => (region.hasCountryFilter ? selectedCountries : regionCountryCodes(region.id)),
    [region, selectedCountries],
  );

  // Station click handler from Journey Planner
  const [journeyStationClickHandler, setJourneyStationClickHandler] = useState<
    ((station: Station | null) => void) | null
  >(null);
  const handleSetStationClickHandler = useCallback(
    (handler: ((station: Station | null) => void) | null) => {
      setJourneyStationClickHandler(() => (handler ? handler : null));
    },
    [],
  );

  // Journey edit mode: route clicks in My Journeys tab go to the edit handler.
  // The handler being set *is* the mode — there is no separate flag, which could
  // disagree with it while a card mounts or unmounts, and then the touch sheet
  // would promise one thing and its button do another.
  const journeyRouteClickHandlerRef = useRef<((route: SelectedRoute) => void) | null>(null);
  // Whether a route is already in the journey being edited — the touch sheet asks
  // before it labels its button. Only the open card knows.
  const journeyContainsRouteRef = useRef<((trackId: number) => boolean) | null>(null);
  const handleJourneyEditStart = useCallback<JourneyEditStartFn>((handler, isRouteInJourney) => {
    journeyRouteClickHandlerRef.current = handler;
    journeyContainsRouteRef.current = isRouteInJourney;
  }, []);
  const handleJourneyEditEnd = useCallback(() => {
    journeyRouteClickHandlerRef.current = null;
    journeyContainsRouteRef.current = null;
  }, []);

  // Highlighted routes, one set per kind: 'planner' (gold) is the Journey Planner's
  // result, 'view' (orange) the My Trips item open. `partials` carries the covered
  // stretch of any route the highlight should only cover part of (the planner
  // joining a route mid-way). Each kind belongs to one tab and only the open tab's
  // is drawn. The planner's set outlives a look at another tab, since the Route
  // Logger stays mounted behind it; My Trips clears its own as it unmounts.
  const [highlights, setHighlights] = useState<Record<HighlightKind, HighlightSet>>(NO_HIGHLIGHTS);
  // Bumped whenever journeys change, to refetch the ridden-stretch overlay
  const [coverageVersion, setCoverageVersion] = useState(0);

  // Selected routes state
  const [selectedRoutes, setSelectedRoutes] = useState<SelectedRoute[]>([]);
  const selectedRoutesRef = useRef<SelectedRoute[]>([]);
  selectedRoutesRef.current = selectedRoutes;

  // Initialize map
  // The station dots and their labels are picked against the basemap under them, so
  // they follow the scheme. useMapLibre rebuilds the map when it changes.
  //
  // The user and the country filter are deliberately not deps: they only change the
  // railway_routes source, and rebuilding the map for them threw away the WebGL
  // context and the basemap on every country checkbox. The sources below are read
  // once, at construction; a later change reaches the map through refreshTiles.
  const theme = useResolvedTheme();
  // The route tiles' `v`, shared with useMapTileRefresh: a map rebuilt for a region
  // or scheme change has to carry the latest one, or it would be back on a URL from
  // before the last refresh — a stale tile, the moment anything caches them.
  const routesCacheBusterRef = useRef<number | undefined>(undefined);

  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      region: region.id,
      sources: () => {
        // A session tile is coloured by this user's rides, so it has a `v` from its
        // first request: without one its URL would be the same across page loads and
        // across everyone who signs in on this browser. A visitor's tile is Martin's,
        // the same for everyone, and gets none until a refresh needs one, so it
        // stays cacheable.
        if (userId) routesCacheBusterRef.current ??= Date.now();
        return {
          railway_routes: createRailwayRoutesSource({
            rides: userId ? "session" : undefined,
            cacheBuster: routesCacheBusterRef.current,
            selectedCountries: effectiveCountries,
          }),
          stations: createPublicStationsSource(),
          scenic_lines: createScenicLinesSource(),
          public_notes: createPublicNotesSource(),
        };
      },
      layers: () => createUserMapLayers(theme),
    },
    [region.id],
  );

  // The newest fit asked for. A fit may wait on the server for the routes' bounds,
  // and is dropped if anything happens to the map meanwhile: another highlight (a
  // different item opened, or this one closed) or a camera move (a pan, a station
  // search's flight) — flying off afterwards would take the map away from whatever
  // the user has moved on to.
  const fitRequest = useRef(0);
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  // A ref so the highlight callback stays stable across a region switch: the cards
  // re-run effects on its identity.
  const regionIdRef = useRef(region.id);
  regionIdRef.current = region.id;

  // `known` is the bounds the caller already had (see HighlightOptions); without
  // them they are fetched, which only the local journeys need — they have no
  // partial stretches, so the whole routes' box is the answer.
  const fitToRoutes = useCallback(
    async (ids: number[], known: RouteBounds | null | undefined) => {
      const request = ++fitRequest.current;
      let box = known;
      if (box === undefined) {
        try {
          box = await getRoutesBounds(ids, regionIdRef.current);
        } catch (error) {
          // Nothing to tell the user: the routes are highlighted all the same
          console.error("Error loading route bounds:", error);
          return;
        }
      }
      const m = map.current;
      if (request !== fitRequest.current || !m || !box) return;
      m.flyTo(fitCamera(m, box, isMobileRef.current));
    },
    [map],
  );

  // Read when a highlight arrives, which may be well after the tab that asked for it
  // was left (a planner search, a trip's routes still loading).
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const handleHighlightRoutes = useCallback<HighlightRoutesFn>(
    (ids, kind = "view", partials = [], options = {}) => {
      const onScreen = TAB_HIGHLIGHT_KIND[activeTabRef.current] === kind;
      // My Trips mounts fresh each time it opens, so a highlight of its arriving after
      // it closed is for a card nobody will see again; kept, it would come back
      // orange the next time the tab opened with nothing open.
      if (!onScreen && kind === "view" && ids.length > 0) return;
      setHighlights((prev) => ({ ...prev, [kind]: { ids, partials } }));
      // Only the tab on screen moves the camera. A planner result landing behind My
      // Trips is kept for the way back, but flying to lines that are not drawn would
      // also cancel the fit of whatever My Trips just opened.
      if (!onScreen) return;
      if (options.fit && ids.length > 0) void fitToRoutes(ids, options.bounds);
      else fitRequest.current++;
    },
    [fitToRoutes],
  );

  // A camera move cancels a pending fit (see fitRequest). The sheet's padding jump
  // is the exception: it keeps what is on screen where it is, so it is not the user
  // going somewhere else.
  useEffect(() => {
    const m = map.current;
    if (!mapLoaded || !m) return;
    const cancelFit = (event: MapLibreEvent & { sheetPadding?: boolean }) => {
      if (!event.sheetPadding) fitRequest.current++;
    };
    m.on("movestart", cancelFit);
    return () => {
      m.off("movestart", cancelFit);
    };
  }, [map, mapLoaded]);

  // An anonymous visitor's rides, coloured from their localStorage log
  const refreshLocalRouteStates = useLocalRouteFeatureStates(map, mapLoaded, dataAccess, showError);

  // Route editor hook
  const routeEditor = useRouteEditor(dataAccess, effectiveCountries);

  // Tile refresh hook: a logged route, a new user or a new country filter
  const { refreshTiles } = useMapTileRefresh({
    map,
    mapLoaded,
    userId,
    selectedCountries: effectiveCountries,
    cacheBusterRef: routesCacheBusterRef,
  });

  // Only the open tab's highlights are drawn: the planner result and the selection
  // on the Route Logger, the open trip or journey on My Trips, nothing on Countries.
  const shownKind = TAB_HIGHLIGHT_KIND[activeTab];
  const shownHighlight = shownKind ? highlights[shownKind] : EMPTY_HIGHLIGHT;
  useRouteHighlighting(
    map,
    mapLoaded,
    shownHighlight.ids,
    shownKind ?? "view",
    activeTab === "routes" ? selectedRoutes : NO_SELECTED_ROUTES,
    shownHighlight.partials,
  );

  // Ridden stretches of routes not yet finished, drawn over the route line
  useCoverageOverlay(map, mapLoaded, dataAccess, effectiveCountries, coverageVersion);

  // Layer filter hooks. mapLoaded applies persisted prefs once layers exist.
  useLayerFilters(
    map,
    layerPrefs.showHeritage,
    layerPrefs.showSpecial,
    // The stored preference is shared across regions; one that offers no scenic
    // lines keeps them off regardless of what the other region left switched on.
    layerPrefs.showScenicLines && region.hasScenicHighlight,
    effectiveCountries,
    mapLoaded,
  );

  // Route click handler
  const handleRouteClick = useCallback(
    (route: SelectedRoute) => {
      // Journey edit mode: delegate to the journey edit handler
      const journeyHandler = journeyRouteClickHandlerRef.current;
      if (journeyHandler) {
        journeyHandler(route);
        return;
      }

      if (activeTab !== "routes") return;

      // Toggle: if already selected, remove it
      const isSelected = selectedRoutesRef.current.some((r) => r.track_id === route.track_id);
      if (isSelected) {
        setSelectedRoutes((prev) => prev.filter((r) => r.track_id !== route.track_id));
        return;
      }

      // No journey-cap check here: selecting a route is reading the map, not
      // logging, and the cap is enforced where it is actually reached — the
      // local logger's banner counts the journeys down and its Log Journey
      // button is disabled at the limit. Checking on every click only meant an
      // error toast for a capped user who wanted to look at a line.
      setSelectedRoutes((prev) => [...prev, route]);
    },
    [activeTab],
  );

  // What a tap on a route is about to do, worded for the touch sheet's button.
  // It mirrors handleRouteClick above branch for branch — the sheet says what the
  // press will do, so the two must not drift. Null where a tap does nothing.
  const routeTapAction = useCallback(
    (trackId: number) => {
      if (journeyRouteClickHandlerRef.current) {
        const inJourney = journeyContainsRouteRef.current?.(trackId) ?? false;
        return { label: inJourney ? "Remove from journey" : "Add to journey" };
      }
      if (activeTab !== "routes") return null;
      const isSelected = selectedRoutesRef.current.some((r) => r.track_id === trackId);
      return { label: isSelected ? "Remove from selection" : "Add to selection" };
    },
    [activeTab],
  );

  // Switching regions drops everything picked out of the old one: a selection
  // logged after the switch would file the other continent's routes under this
  // journey, and a highlight would point at track the map can no longer show.
  // biome-ignore lint/correctness/useExhaustiveDependencies: region.id is the trigger; the setters are stable and intentionally not read here.
  useEffect(() => {
    setSelectedRoutes([]);
    setHighlights(NO_HIGHLIGHTS);
    fitRequest.current++;
  }, [region.id]);

  const handleRemoveRoute = useCallback((trackId: number) => {
    setSelectedRoutes((prev) => prev.filter((r) => r.track_id !== trackId));
  }, []);

  const handleClearAll = useCallback(() => {
    setSelectedRoutes([]);
  }, []);

  const handleUpdateRoutePartial = useCallback((trackId: number, partial: boolean) => {
    setSelectedRoutes((routes) =>
      routes.map((r) => (r.track_id === trackId ? { ...r, partial } : r)),
    );
  }, []);

  const handleAddRoutesFromLogger = useCallback((routes: PlannerRoute[]) => {
    const newRoutes = routes.map((route) => ({
      track_id: route.track_id,
      name: route.name,
      from_station: route.from_station,
      to_station: route.to_station,
      description: route.description || "",
      usage_types: "",
      link: null,
      date: null,
      journey_name: null,
      // A plan that joins this route mid-way only covers part of it, so the
      // route arrives in the selection with "partial" already ticked and the
      // ridden stretch attached, ready to be stored with the journey
      partial: route.partial ? true : null,
      covered: route.partial ?? null,
      travelled_length_km: route.partial ? route.travelled_length_km : null,
      length_km: route.length_km,
    }));

    setSelectedRoutes((prev) => {
      const routesToAdd = newRoutes.filter(
        (newRoute) => !prev.some((existingRoute) => existingRoute.track_id === newRoute.track_id),
      );
      return [...prev, ...routesToAdd];
    });
  }, []);

  const handleRoutesLogged = useCallback(() => {
    if (user) {
      refreshTiles();
      routeEditor.refreshProgress();
    } else {
      void refreshLocalRouteStates();
      routeEditor.refreshProgress();
    }
    // Journeys changed, so the ridden stretches of unfinished routes may have too
    setCoverageVersion((v) => v + 1);
  }, [user, refreshTiles, refreshLocalRouteStates, routeEditor.refreshProgress]);

  // Refresh the route tiles when the user changes (login/logout): the map outlives
  // it, and the tiles must switch between this user's rides and none. The mount
  // run is skipped: useMapLibre has just built the route source for this user.
  // Deliberately not gated on the map existing — a map still being built took its
  // source from before the change, and useMapTileRefresh applies a refresh asked
  // for before load once the map has loaded.
  //
  // The country list is taken over from the server along with the user. The state
  // only reads its prop on mount, so it kept the visitor's list across a login —
  // and the next checkbox then saved that list over the account's own. The server
  // render that brings the new user brings the new list with it, and setting the
  // two together means the refresh runs with the right countries.
  const previousUserIdRef = useRef<number | null | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the user is the trigger; initialSelectedCountries arrives with it and must not re-run this on its own, or a server refresh would undo an unsaved country toggle.
  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    previousUserIdRef.current = userId;
    if (previousUserId === undefined || previousUserId === userId) return;
    setSelectedCountries(initialSelectedCountries);
    // The Route Logger is rebuilt for the new user (account or localStorage), and its
    // planner with it, so a result still highlighted would have no form behind it.
    setHighlights(NO_HIGHLIGHTS);
    fitRequest.current++;
    refreshTiles();
  }, [userId, refreshTiles]);

  useUserMapInteractions(map, mapLoaded, {
    onRouteClick: handleRouteClick,
    onStationClick:
      activeTab === "routes" && journeyStationClickHandler ? journeyStationClickHandler : undefined,
    region: region.id,
    routeTapAction,
  });

  // Fetch progress stats on mount
  useEffect(() => {
    if (mapLoaded) routeEditor.refreshProgress();
  }, [mapLoaded, routeEditor.refreshProgress]);

  // Country filter saves run one at a time, and while one is in flight only the
  // newest list waits behind it: toggling fast used to send concurrent saves
  // that could land out of order and store an older list. The map and stats
  // switch at once regardless, so a failure is the one thing the user can't see
  // for themselves; it is reported unless a newer save is about to replace it.
  //
  // The queue belongs to one user and saves through that user's data access. A
  // login or logout starts a fresh one and drops whatever the old one still had
  // waiting, so a list is never saved to an account other than the one it was
  // picked under, and the new session's first save doesn't wait behind the old.
  // Keyed on the user rather than on `dataAccess`, which a region switch also
  // replaces without changing where preferences are stored.
  const countrySaveRef = useRef<CountrySaveQueue | null>(null);

  const saveCountries = async (countries: string[]) => {
    let queue = countrySaveRef.current;
    if (!queue || queue.userId !== userId) {
      if (queue) queue.pending = null;
      queue = { userId, dataAccess, running: false, pending: null };
      countrySaveRef.current = queue;
    }
    queue.pending = countries;
    if (queue.running) return;
    queue.running = true;
    try {
      while (queue.pending) {
        const next = queue.pending;
        queue.pending = null;
        try {
          await queue.dataAccess.updateUserPreferences(next);
        } catch (error) {
          console.error("Error updating country preferences:", error);
          if (!queue.pending && countrySaveRef.current === queue) {
            showError("Couldn't save your country selection; it will revert on the next visit");
          }
        }
      }
    } finally {
      queue.running = false;
    }
  };

  // Country filter handler. The tiles take the filter from their URL, not from the
  // saved preference, so the refresh need not wait for the save; batched with the
  // state update, it runs with the new list.
  const handleCountriesChange = (countries: string[]) => {
    setSelectedCountries(countries);
    refreshTiles();
    void saveCountries(countries);
  };

  // How much of the map the mobile sheet covers, as bottom camera padding. The sheet
  // lies over the map rather than shrinking it (see MobileBottomSheet), so this is
  // what keeps centring, flyTo and fitBounds aimed at the part still visible.
  const sheetCover = useRef(0);
  // The map a padding already waits on a `moveend` for, so settles during one flight
  // queue a single retry rather than one each.
  const paddingWaitsOn = useRef<typeof map.current>(null);
  // The map whose first padding has been set (see the effect below).
  const paddedMap = useRef<typeof map.current>(null);
  // True while a desktop/mobile layout switch is pending: its own timer applies the
  // padding, once the map has been resized to the new layout.
  const layoutSwitching = useRef(false);

  // A new padding normally moves the camera: the centre stays put and is re-drawn
  // at the new padded centre. So the centre is first moved to whatever is on screen
  // at that spot, and the map does not shift under the sheet. Mid-flight (a station
  // search's flyTo, geolocation, a pan still coasting) a jump would stop the camera
  // where it is, so the padding waits for it to land.
  const applySheetPadding = useCallback(() => {
    const apply = () => {
      const m = map.current;
      if (!m) return;
      const bottom = sheetCover.current;
      if (m.getPadding().bottom === bottom) return;
      if (m.isMoving()) {
        if (paddingWaitsOn.current !== m) {
          paddingWaitsOn.current = m;
          m.once("moveend", () => {
            paddingWaitsOn.current = null;
            apply();
          });
        }
        return;
      }
      const { clientWidth, clientHeight } = m.getContainer();
      const center = m.unproject([clientWidth / 2, (clientHeight - bottom) / 2]);
      // Tagged so the jump does not cancel a pending fit (see cancelFit)
      m.jumpTo({ center, padding: { top: 0, left: 0, right: 0, bottom } }, { sheetPadding: true });
    };
    apply();
  }, [map]);

  const handleSheetSettled = useCallback(
    (covered: number) => {
      sheetCover.current = covered;
      if (mapLoaded && !layoutSwitching.current) applySheetPadding();
    },
    [mapLoaded, applySheetPadding],
  );

  // A freshly built map takes the padding as it stands, without the compensation
  // above: it has just opened at the saved centre, which was the centre of the
  // visible part when it was saved, and that is where it should appear again.
  useEffect(() => {
    const m = map.current;
    if (!mapLoaded || !m || paddedMap.current === m) return;
    paddedMap.current = m;
    m.setPadding({ top: 0, left: 0, right: 0, bottom: isMobile ? sheetCover.current : 0 });
  }, [mapLoaded, isMobile, map]);

  // Runs on every frame the sheet moves. The furniture offset goes on the map pane —
  // the only subtree that reads it — rather than on an ancestor of the sheet, which
  // would restyle the whole sidebar per frame. React drops the furniture update
  // whenever the answer has not changed.
  const handleSheetCoverChange = useCallback((covered: number, room: number) => {
    mapPane.current?.style.setProperty("--sheet-visible", `${covered}px`);
    setFurnitureFits(room >= MAP_FURNITURE_MIN_HEIGHT_PX);
  }, []);

  // Resize map when the layout switches between the desktop sidebar and the mobile
  // sheet (the sheet itself never resizes the map; it lies over it), then give it
  // the new layout's padding. Uncompensated on purpose: a layout switch keeps the
  // centre, as the resize itself does.
  useEffect(() => {
    layoutSwitching.current = true;
    if (!isMobile) mapPane.current?.style.removeProperty("--sheet-visible");
    // Small delay to let CSS transitions finish
    const timer = setTimeout(() => {
      layoutSwitching.current = false;
      const m = map.current;
      if (!m) return;
      m.resize();
      m.setPadding({ top: 0, left: 0, right: 0, bottom: isMobile ? sheetCover.current : 0 });
    }, 300);
    return () => {
      clearTimeout(timer);
      layoutSwitching.current = false;
    };
  }, [isMobile, map]);

  // Only the sheet can take the room away, so the desktop layout always has it.
  const showFurniture = !isMobile || furnitureFits;

  // What the collapsed sheet calls itself. Not the active tab: all three of the
  // sheet's tabs are the logger. The count is the one thing worth surfacing from
  // behind a closed sheet — routes are picked on the map, which is exactly when the
  // sheet is down and the selection is out of sight.
  const sheetLabel =
    selectedRoutes.length > 0 ? `Route Logger · ${selectedRoutes.length} selected` : "Route Logger";

  // The summary bar's "Log journey": the sheet raises itself, this brings the form
  // into view — after the commit that unhides the Route Logger, since a hidden
  // element cannot be scrolled to. Its own scroll container only, never
  // `scrollIntoView`: the sheet is still translated down at the start of its snap,
  // and the browser would make up the difference by scrolling the overflow-hidden
  // ancestors — the map root and the map pane — which then jump back when the
  // transform comes off. Both rects sit under the same transform, so their
  // difference is the form's offset in the container whatever the sheet is doing.
  const handleLogFromSummary = useCallback(() => {
    setActiveTab("routes");
    requestAnimationFrame(() => {
      const form = document.getElementById(NEW_JOURNEY_FORM_ID);
      let scroller = form?.parentElement ?? null;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      if (!form || !scroller) return;
      const offset = form.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: scroller.scrollTop + offset - 8, behavior: "smooth" });
    });
  }, [setActiveTab]);

  // The same limit LocalTripLogger disables its form on, read per render as it is
  // there: logging clears the selection, which re-renders this.
  const summaryBlockedReason =
    selectedRoutes.length > 0 && !user && !localStore.canAddMoreJourneys()
      ? localStore.JOURNEY_LIMIT_MESSAGE
      : null;

  // Sidebar content (shared between mobile drawer and desktop inline)
  const sidebarContent = (
    <UserSidebar
      user={user}
      dataAccess={dataAccess}
      selectedRoutes={selectedRoutes}
      onRemoveRoute={handleRemoveRoute}
      onClearAll={handleClearAll}
      onUpdateRoutePartial={handleUpdateRoutePartial}
      onHighlightRoutes={handleHighlightRoutes}
      onAddRoutesFromPlanner={handleAddRoutesFromLogger}
      onRoutesLogged={handleRoutesLogged}
      selectedCountries={selectedCountries}
      onCountryChange={handleCountriesChange}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onStationClickHandler={handleSetStationClickHandler}
      sidebarWidth={isMobile ? null : sidebarWidth}
      onJourneyEditStart={handleJourneyEditStart}
      onJourneyEditEnd={handleJourneyEditEnd}
    />
  );

  return (
    <div className={`h-full relative ${isMobile ? "overflow-hidden" : "flex"}`}>
      {/* Desktop sidebar */}
      {!isMobile && (
        <>
          {sidebarContent}
          {/* Resizer: mouse-only drag handle (keyboard resize intentionally unsupported) */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: mouse-only resize affordance with no keyboard equivalent; the sidebar remains fully usable without resizing. */}
          <div
            onMouseDown={onSidebarResize}
            className={`w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize flex-shrink-0 ${isResizing ? "bg-blue-400" : ""}`}
            style={{ userSelect: "none" }}
          />
        </>
      )}

      {/* Map Container. `map-pane` is what globals.css keys on to lift MapLibre's
          bottom controls above the sheet lying over it. On mobile it is the full
          height of the column, whatever the sheet is doing. */}
      <div
        ref={mapPane}
        className={`map-pane overflow-hidden relative ${isMobile ? "h-full" : "flex-1 min-h-0"} ${
          showFurniture ? "" : "map-pane-short"
        }`}
      >
        <div
          ref={mapContainer}
          className={`w-full h-full ${className}`}
          style={{ height: "100%", minHeight: isMobile ? undefined : "400px" }}
        />

        {/* Progress Stats Box */}
        {routeEditor.progress && (
          <MapProgressBox
            progress={routeEditor.progress}
            isMobile={isMobile}
            // The switches live in the hamburger menu at every width — see MenuSheet.
            withLayerToggles={false}
          />
        )}

        <MapStationSearch
          map={map}
          region={region.id}
          isMobile={isMobile}
          hidden={!showFurniture}
        />
      </div>

      {/* Mobile bottom sheet, lying over the map */}
      {isMobile && (
        <MobileBottomSheet
          onSettled={handleSheetSettled}
          onCoverChange={handleSheetCoverChange}
          collapsedLabel={sheetLabel}
          peekContent={
            selectedRoutes.length > 0 ? (
              <SelectionSummaryBar
                routes={selectedRoutes}
                onLog={handleLogFromSummary}
                blockedReason={summaryBlockedReason}
              />
            ) : undefined
          }
        >
          {sidebarContent}
        </MobileBottomSheet>
      )}
    </div>
  );
}
