"use client";

import type { MapLibreEvent } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SidebarResizer from "@/components/layout/SidebarResizer";
import SelectionSummaryBar from "@/components/logbook/SelectionSummaryBar";
import UserSidebar, { type ActiveTab } from "@/components/logbook/UserSidebar";
import MapProgressBox from "@/components/map/MapProgressBox";
import MapStationSearch from "@/components/map/MapStationSearch";
import MobileBottomSheet from "@/components/ui/MobileBottomSheet";
import type { User } from "@/lib/authActions";
import { createDataAccess, type DataAccess } from "@/lib/dataAccess";
import { journeyEditChanged, useJourneyEditRoutes } from "@/lib/journeyEdit";
import * as localStore from "@/lib/localStorage";
import { fitCamera } from "@/lib/map/fitCamera";
import { useLocalRouteFeatureStates } from "@/lib/map/hooks/useLocalRouteFeatureStates";
import { useRouteHighlighting } from "@/lib/map/hooks/useRouteHighlighting";
import { useUserMap } from "@/lib/map/hooks/useUserMap";
import { useUserMapInteractions } from "@/lib/map/hooks/useUserMapInteractions";
import { useRegion } from "@/lib/regionContext";
import { NEW_JOURNEY_FORM_ID } from "@/lib/selectedRoutes";
import type {
  HighlightKind,
  HighlightRoutesFn,
  PartialRouteGeometry,
  PlannerRoute,
  RouteBounds,
  SelectedRoute,
  Station,
} from "@/lib/shared/types";
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
  map: null,
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
  sidebarWidth: string;
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
  // On the user's id, not the object: a server render hands down a fresh `user` for
  // the same account, and a new data access means a new owner to useUserMap.
  const dataAccess = useMemo(() => createDataAccess(userId, region.id), [userId, region.id]);
  const { showError } = useToast();

  // Country filter state
  const [selectedCountries, setSelectedCountries] = useState<string[]>(initialSelectedCountries);

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

  // The saved journey the Route Logger is editing (see journeyEdit.ts), null while
  // it puts together a new one. Its routes are the draft's, and every selection
  // handler below works on them in place of `selectedRoutes`, which waits
  // untouched for the edit to end. Editing is the draft existing: one dropped
  // elsewhere (its journey deleted) ends the edit with it. Only its routes and
  // name are read here, so typing in its form doesn't re-render the map.
  const [editingJourneyId, setEditingJourneyId] = useState<number | string | null>(null);
  const journeyEdit = useJourneyEditRoutes(editingJourneyId);
  const editing = journeyEdit.routes !== undefined;
  useEffect(() => {
    if (editingJourneyId !== null && !editing) setEditingJourneyId(null);
  }, [editingJourneyId, editing]);
  // The journey My Trips opens on its next mount: the one just edited, so Save or
  // Cancel lands back on it. Dropped once My Trips is left again.
  const [reopenJourneyId, setReopenJourneyId] = useState<number | string | null>(null);
  useEffect(() => {
    if (activeTab !== "journeylog") setReopenJourneyId(null);
  }, [activeTab]);

  // Highlighted routes, one set per kind: 'planner' (gold) is the Journey Planner's
  // result, 'view' (orange) the My Trips item open. `partials` carries the covered
  // stretch of any route the highlight should only cover part of (the planner
  // joining a route mid-way). Each kind belongs to one tab and only the open tab's
  // is drawn. The planner's set outlives a look at another tab, since the Route
  // Logger stays mounted behind it; My Trips clears its own as it unmounts.
  const [highlights, setHighlights] = useState<Record<HighlightKind, HighlightSet>>(NO_HIGHLIGHTS);

  // The country list is taken over from the server along with the user. The state
  // only reads its prop on mount, so it kept the visitor's list across a login —
  // and the next checkbox then saved that list over the account's own. The server
  // render that brings the new user brings the new list with it. Taken over during
  // render rather than in an effect, so no render pairs the new user with the old
  // list: the progress figures and the ridden stretches, which refetch on either,
  // would ask twice, the first time for figures nobody sees.
  //
  // The highlights go with them. The Route Logger is rebuilt for the new user
  // (account or localStorage), and its planner with it, so a result still
  // highlighted would have no form behind it.
  const [stateUserId, setStateUserId] = useState(userId);
  if (stateUserId !== userId) {
    setStateUserId(userId);
    setSelectedCountries(initialSelectedCountries);
    setHighlights(NO_HIGHLIGHTS);
    // The drafts went with the account (editGuard)
    setEditingJourneyId(null);
    setReopenJourneyId(null);
  }

  // Bumped whenever journeys change, to refetch the ridden-stretch overlay
  const [coverageVersion, setCoverageVersion] = useState(0);

  // Selected routes state: the new journey's
  const [selectedRoutes, setSelectedRoutes] = useState<SelectedRoute[]>([]);

  // What the Route Logger shows and the map clicks change: the journey being
  // edited, or the new one. The handlers read through refs, and a draft update
  // works from the draft as it stands, so two changes before a render both land.
  const loggerRoutes = journeyEdit.routes ?? selectedRoutes;
  const loggerRoutesRef = useRef(loggerRoutes);
  loggerRoutesRef.current = loggerRoutes;
  const editRef = useRef({ editing, update: journeyEdit.update });
  editRef.current = { editing, update: journeyEdit.update };
  const updateLoggerRoutes = useCallback((update: (routes: SelectedRoute[]) => SelectedRoute[]) => {
    const { editing, update: updateDraft } = editRef.current;
    if (!editing) {
      setSelectedRoutes(update);
      return;
    }
    updateDraft((draft) => ({
      ...draft,
      edit: { ...draft.edit, routes: update(draft.edit.routes) },
    }));
  }, []);

  // Only the sheet can take the room away, so the desktop layout always has it.
  const showFurniture = !isMobile || furnitureFits;

  // An anonymous visitor's ridden routes, reported by useLocalRouteFeatureStates
  // below, for the closed ones among them to stay on the map
  const [localRiddenTrackIds, setLocalRiddenTrackIds] = useState<number[]>([]);

  // A login, a logout or a country checkbox reloads the route tiles by itself (see
  // useUserMap); a logged ride asks with refreshTiles. The searched line stands down
  // with the search box, whose chip is the only way to clear it.
  const {
    map,
    mapLoaded,
    progress,
    progressFailed,
    progressPending,
    refreshProgress,
    refreshTiles,
    lineHighlight,
  } = useUserMap(mapContainer, {
    dataAccess,
    selectedCountries,
    // A visitor's tile is Martin's; their rides are laid on as feature state below
    rides: userId ? "session" : undefined,
    coverageVersion,
    lineHighlightHidden: !showFurniture,
    localRiddenTrackIds,
  });

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
  const refreshLocalRouteStates = useLocalRouteFeatureStates(
    map,
    mapLoaded,
    dataAccess,
    showError,
    setLocalRiddenTrackIds,
  );

  // Only the open tab's highlights are drawn: the planner result and the selection
  // on the Route Logger, the open trip or journey on My Trips, nothing on Countries.
  const shownKind = TAB_HIGHLIGHT_KIND[activeTab];
  const shownHighlight = shownKind ? highlights[shownKind] : EMPTY_HIGHLIGHT;
  useRouteHighlighting(
    map,
    mapLoaded,
    shownHighlight.ids,
    shownKind ?? "view",
    activeTab === "routes" ? loggerRoutes : NO_SELECTED_ROUTES,
    shownHighlight.partials,
  );

  // Route click handler: toggles the route in the Route Logger's routes, the new
  // journey's or the edited one's
  const handleRouteClick = useCallback(
    (route: SelectedRoute) => {
      if (activeTab !== "routes") return;

      // No journey-cap check here: selecting a route is reading the map, not
      // logging, and the cap is enforced where it is actually reached — the
      // local logger's banner counts the journeys down and its Log Journey
      // button is disabled at the limit. Checking on every click only meant an
      // error toast for a capped user who wanted to look at a line.
      updateLoggerRoutes((routes) =>
        routes.some((r) => r.track_id === route.track_id)
          ? routes.filter((r) => r.track_id !== route.track_id)
          : [...routes, route],
      );
    },
    [activeTab, updateLoggerRoutes],
  );

  // What a tap on a route is about to do, worded for the touch sheet's button.
  // It mirrors handleRouteClick above branch for branch — the sheet says what the
  // press will do, so the two must not drift. Null where a tap does nothing.
  const routeTapAction = useCallback(
    (trackId: number) => {
      if (activeTab !== "routes") return null;
      const isSelected = loggerRoutesRef.current.some((r) => r.track_id === trackId);
      if (editRef.current.editing) {
        return { label: isSelected ? "Remove from journey" : "Add to journey" };
      }
      return { label: isSelected ? "Remove from selection" : "Add to selection" };
    },
    [activeTab],
  );

  // Switching regions drops everything picked out of the old one: a selection
  // logged after the switch would file the other continent's routes under this
  // journey, and a highlight would point at track the map can no longer show. A
  // journey being edited is a draft, and is kept (editGuard): its routes are its own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: region.id is the trigger; the setters are stable and intentionally not read here.
  useEffect(() => {
    setSelectedRoutes([]);
    setHighlights(NO_HIGHLIGHTS);
    fitRequest.current++;
  }, [region.id]);

  const handleRemoveRoute = useCallback(
    (trackId: number) => {
      updateLoggerRoutes((prev) => prev.filter((r) => r.track_id !== trackId));
    },
    [updateLoggerRoutes],
  );

  const handleClearAll = useCallback(() => {
    updateLoggerRoutes(() => []);
  }, [updateLoggerRoutes]);

  const handleAddRoutesFromLogger = useCallback(
    (routes: PlannerRoute[]) => {
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

      updateLoggerRoutes((prev) => {
        const routesToAdd = newRoutes.filter(
          (newRoute) => !prev.some((existingRoute) => existingRoute.track_id === newRoute.track_id),
        );
        return [...prev, ...routesToAdd];
      });
    },
    [updateLoggerRoutes],
  );

  const handleRoutesLogged = useCallback(() => {
    if (user) refreshTiles();
    else void refreshLocalRouteStates();
    void refreshProgress();
    // Journeys changed, so the ridden stretches of unfinished routes may have too
    setCoverageVersion((v) => v + 1);
  }, [user, refreshTiles, refreshLocalRouteStates, refreshProgress]);

  // Edit in My Trips: the card has written the journey's draft, and the Route
  // Logger takes it up. The journey it was showing keeps its draft if it has
  // changes, and is put away with an Unsaved on its card; one with none goes.
  const handleEditJourney = useCallback(
    (id: number | string) => {
      const { editing, update } = editRef.current;
      if (editing && editingJourneyId !== id) {
        update((draft) => (journeyEditChanged(draft) ? draft : null));
      }
      setEditingJourneyId(id);
      setActiveTab("routes");
    },
    [editingJourneyId, setActiveTab],
  );

  // Saved or cancelled (the Route Logger drops the draft first): back to My Trips,
  // open on the journey
  const handleJourneyEditEnd = useCallback(
    (saved: boolean) => {
      setReopenJourneyId(editingJourneyId);
      setEditingJourneyId(null);
      if (saved) handleRoutesLogged();
      setActiveTab("journeylog");
    },
    [editingJourneyId, handleRoutesLogged, setActiveTab],
  );

  // A login or logout clears the highlights (with the country list, above), and a
  // fit still waiting on one is dropped with them
  // biome-ignore lint/correctness/useExhaustiveDependencies: userId is the trigger.
  useEffect(() => {
    fitRequest.current++;
  }, [userId]);

  useUserMapInteractions(map, mapLoaded, {
    onRouteClick: handleRouteClick,
    onStationClick:
      activeTab === "routes" && journeyStationClickHandler ? journeyStationClickHandler : undefined,
    region: region.id,
    routeTapAction,
  });

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
  // saved preference, so their refresh (useUserMap) need not wait for the save.
  const handleCountriesChange = (countries: string[]) => {
    setSelectedCountries(countries);
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

  // What the collapsed sheet calls itself: the tab that tapping it opens again, now
  // that one of them (Map & Stats) is no part of the logger. The count is the one
  // thing worth surfacing from behind a closed sheet, whichever tab is open — routes
  // are picked on the map, which is exactly when the sheet is down and the selection
  // is out of sight.
  const tabName =
    activeTab === "routes"
      ? "Route Logger"
      : activeTab === "journeylog"
        ? user
          ? "My Trips"
          : "My Journeys"
        : "Map & Stats";
  const sheetLabel = editing
    ? `${tabName} · editing`
    : selectedRoutes.length > 0
      ? `${tabName} · ${selectedRoutes.length} selected`
      : tabName;

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
    !editing && selectedRoutes.length > 0 && !user && !localStore.canAddMoreJourneys()
      ? localStore.JOURNEY_LIMIT_MESSAGE
      : null;

  // Sidebar content (shared between mobile drawer and desktop inline)
  const sidebarContent = (
    <UserSidebar
      user={user}
      dataAccess={dataAccess}
      selectedRoutes={loggerRoutes}
      editingJourneyId={editing ? editingJourneyId : null}
      onEditJourney={handleEditJourney}
      onJourneyEditEnd={handleJourneyEditEnd}
      reopenJourneyId={reopenJourneyId}
      onRemoveRoute={handleRemoveRoute}
      onClearAll={handleClearAll}
      onHighlightRoutes={handleHighlightRoutes}
      onAddRoutesFromPlanner={handleAddRoutesFromLogger}
      onRoutesLogged={handleRoutesLogged}
      selectedCountries={selectedCountries}
      onCountryChange={handleCountriesChange}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onStationClickHandler={handleSetStationClickHandler}
      sidebarWidth={isMobile ? null : sidebarWidth}
    />
  );

  return (
    <div className={`h-full relative ${isMobile ? "overflow-hidden" : "flex"}`}>
      {/* Desktop sidebar */}
      {!isMobile && (
        <>
          {sidebarContent}
          <SidebarResizer onMouseDown={onSidebarResize} isResizing={isResizing} />
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
        <MapProgressBox
          progress={progress}
          failed={progressFailed}
          pending={progressPending}
          onRetry={refreshProgress}
          isMobile={isMobile}
          // The switches live in the sidebar's Map & Stats tab at every width.
          withLayerToggles={false}
        />

        <MapStationSearch
          map={map}
          lineHighlight={lineHighlight}
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
            editing || selectedRoutes.length > 0 ? (
              <SelectionSummaryBar
                routes={loggerRoutes}
                editing={editing ? journeyEdit.name : null}
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
