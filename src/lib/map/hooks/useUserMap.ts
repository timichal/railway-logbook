import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataAccess } from "@/lib/dataAccess";
import {
  createPublicNotesSource,
  createPublicStationsSource,
  createRailwayRoutesSource,
  createScenicLinesSource,
} from "@/lib/map";
import { useCoverageOverlay } from "@/lib/map/hooks/useCoverageOverlay";
import { useLayerFilters } from "@/lib/map/hooks/useLayerFilters";
import { useLineSearchHighlight } from "@/lib/map/hooks/useLineSearchHighlight";
import { useMapLibre } from "@/lib/map/hooks/useMapLibre";
import { useRouteRides } from "@/lib/map/hooks/useRouteRides";
import { useLayerPrefs } from "@/lib/map/layerPrefsContext";
import { useRegion } from "@/lib/regionContext";
import { type UsageType, usageOptions } from "@/lib/shared/constants";
import { routeLineLayerId } from "@/lib/shared/map/layers";
import { NO_RIDES } from "@/lib/shared/map/routeRides";
import { createUserMapLayers, shownUsageTypes } from "@/lib/shared/map/userMapLayers";
import {
  getUserRouteColorExpression,
  getUserRouteSortKeyExpression,
} from "@/lib/shared/map/utils/userRouteStyling";
import type { UserProgress } from "@/lib/shared/progress";
import { countedUsageTypes, regionCountryCodes } from "@/lib/shared/regions";
import { useResolvedTheme } from "@/lib/theme";
import { useToast } from "@/lib/toast";

interface UseUserMapOptions {
  /**
   * Whose numbers, rides and ridden stretches: the session, localStorage or a
   * share token. A new one is a new owner, whose rides replace the last one's at
   * once, so memoise it on who it is, not on objects that are replaced without that
   * changing.
   */
  dataAccess: DataAccess;
  /** The country filter as stored, before a single-country region pins it. */
  selectedCountries: string[];
  /** Bumped when journeys change, to refetch the ridden-stretch overlay. */
  coverageVersion?: number;
  /** Stands the searched-line band down — see `useLineSearchHighlight`. */
  lineHighlightHidden?: boolean;
  /**
   * Whether the progress box counts only the usage types the map shows. True on the
   * user's own map, where the switches are their filter; false on a shared one,
   * whose box is the owner's figures and must not depend on the visitor's
   * switches — there they change what is drawn and nothing else.
   */
  progressFollowsLayers?: boolean;
}

/**
 * The map both user maps draw — the signed-in or anonymous one and the shared one:
 * the sources and layers, the owner's rides over the route tiles, the progress
 * figures, the ridden stretches, the layer switches and the searched line. What
 * either adds on top (selection, highlights, interactions) stays with it.
 */
export function useUserMap(
  mapContainer: React.RefObject<HTMLDivElement | null>,
  {
    dataAccess,
    selectedCountries,
    coverageVersion = 0,
    lineHighlightHidden = false,
    progressFollowsLayers = true,
  }: UseUserMapOptions,
) {
  const region = useRegion();
  const layerPrefs = useLayerPrefs();
  const { showError } = useToast();

  // The country list everything on the map actually filters by. A region the user
  // can't filter by country (Japan, one country) pins it to its own list, which is
  // what keeps the other region's routes, stats and ridden stretches out of this
  // view - the country filter was already doing that job for the European
  // countries, and the regions just happen to be disjoint sets of it.
  const effectiveCountries = useMemo(
    () => (region.hasCountryFilter ? selectedCountries : regionCountryCodes(region.id)),
    [region, selectedCountries],
  );

  // The route colours, the ridden stretches and the station dots and labels are
  // picked against the basemap under them, so they follow the scheme. useMapLibre
  // rebuilds the map when it changes.
  const theme = useResolvedTheme();

  // The owner's rides, which colour and order the routes and keep their closed
  // ones on the map. The route tile is Martin's, the same for everyone and never
  // refetched for them: a login, a logout or a logged ride only restyle the layers
  // (below), from the tiles already loaded. Asked for at once, so they are usually
  // here when the map is built (read through the ref, since `layers` runs in an
  // earlier render's closure).
  const { rides, refresh: refreshRides } = useRouteRides(dataAccess, showError);
  const ridesRef = useRef(rides);
  ridesRef.current = rides;

  const { map, mapLoaded, mapStatus } = useMapLibre(
    mapContainer,
    {
      region: region.id,
      sources: () => ({
        railway_routes: createRailwayRoutesSource(),
        stations: createPublicStationsSource(),
        scenic_lines: createScenicLinesSource(),
        public_notes: createPublicNotesSource(),
      }),
      // Built with the countries and the rides as they are, so nothing outside
      // them flashes, and nothing uncoloured, before the effects below take over
      layers: () => createUserMapLayers(theme, effectiveCountries, ridesRef.current),
    },
    [region.id],
  );

  // A change of rides restyles the route lines in place. MapLibre compares each
  // value with the one it holds, so a re-run with the same rides costs nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mapLoaded is an intentional re-run trigger (restyle once the layers exist), not a value read inside the effect.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const color = getUserRouteColorExpression(theme, rides ?? NO_RIDES);
    const sortKey = getUserRouteSortKeyExpression(rides ?? NO_RIDES);
    for (const { id: type } of usageOptions) {
      const id = routeLineLayerId(type);
      if (!m.getLayer(id)) continue;
      m.setPaintProperty(id, "line-color", color);
      m.setLayoutProperty(id, "line-sort-key", sortKey);
    }
  }, [map, theme, rides, mapLoaded]);

  // The usage types drawn, which the progress box, the ridden stretches and the
  // searched line follow
  const { showRegular, showHeritage, showSpecial } = layerPrefs;
  const shownTypes = useMemo(
    () => shownUsageTypes({ showRegular, showHeritage, showSpecial }),
    [showRegular, showHeritage, showSpecial],
  );

  // The progress box counts the region's ordinary types (Japan's JR and non-JR
  // lines) among those, so unticking one in the statistics takes it out of the
  // numbers as unticking a country does. Memoised on the counted list's content,
  // not on the shown one: Europe counts Regular only, and its heritage/special
  // switches must not refetch. Undefined - every type the region counts - where
  // the progress does not follow the switches.
  const countedKey = progressFollowsLayers
    ? countedUsageTypes(region.id, shownTypes).join(",")
    : null;
  const countedTypes = useMemo((): UsageType[] | undefined => {
    if (countedKey === null) return undefined;
    return countedKey === "" ? [] : (countedKey.split(",").map(Number) as UsageType[]);
  }, [countedKey]);

  // Each answer is kept with the data access it was asked of, and shown only while
  // that is still the current one: a region switch or a login replaces it, and the
  // rebuilt map sends nothing until it has loaded, so the old answer could otherwise
  // still land after the switch and show the other region's numbers.
  //
  // `failed` marks an answer the newest request failed to replace. Its figures are
  // for an older filter, or from before a ride was logged, and the box says so
  // rather than passing them off as current. A failure with no earlier answer for
  // this data access (first load, region switch, login) is kept too, with no
  // figures, so the box can say it has none and offer to ask again.
  const [answer, setAnswer] = useState<{
    from: DataAccess;
    progress: UserProgress | null;
    failed: boolean;
  } | null>(null);
  const shownAnswer = answer?.from === dataAccess ? answer : null;
  // Only the newest request's answer is kept: toggling countries fast sends
  // several, and they need not come back in order
  const progressRequest = useRef(0);
  // Whether the newest request is still out, whatever started it — a retry, a
  // country toggle or a logged ride — so the box can tell "asking" from "failed"
  const [progressPending, setProgressPending] = useState(false);
  const refreshProgress = useCallback(async () => {
    const request = ++progressRequest.current;
    setProgressPending(true);
    try {
      const next = await dataAccess.getUserProgress(effectiveCountries, countedTypes);
      if (request === progressRequest.current) {
        setAnswer({ from: dataAccess, progress: next, failed: false });
      }
    } catch (error) {
      console.error("Error refreshing progress:", error);
      if (request === progressRequest.current) {
        setAnswer((previous) => ({
          from: dataAccess,
          progress: previous?.from === dataAccess ? previous.progress : null,
          failed: true,
        }));
      }
    } finally {
      if (request === progressRequest.current) setProgressPending(false);
    }
  }, [dataAccess, effectiveCountries, countedTypes]);

  useEffect(() => {
    if (mapLoaded) void refreshProgress();
  }, [mapLoaded, refreshProgress]);

  // Ridden stretches of routes not yet finished, drawn over the route line, and
  // hidden with it: green stretches over no routes would say as little as the
  // routes would uncoloured
  useCoverageOverlay(
    map,
    mapLoaded,
    dataAccess,
    effectiveCountries,
    shownTypes,
    coverageVersion,
    theme,
    rides !== null,
  );

  // The owner's ride on a route, for the popups (`useUserMapInteractions`)
  const routeRide = useCallback((trackId: number) => rides?.byId.get(trackId), [rides]);

  // mapLoaded applies the persisted switches once the layers exist
  useLayerFilters(
    map,
    shownTypes,
    // The stored preference is shared across regions; one that offers no scenic
    // lines keeps them off regardless of what the other region left switched on.
    layerPrefs.showScenicLines && region.hasScenicHighlight,
    effectiveCountries,
    layerPrefs.showClosed,
    rides,
    mapLoaded,
  );

  // The line picked in the search box, highlighted on the map
  const lineHighlight = useLineSearchHighlight(
    map,
    mapLoaded,
    region.id,
    shownTypes,
    lineHighlightHidden,
  );

  return {
    map,
    mapLoaded,
    mapStatus,
    progress: shownAnswer?.progress ?? null,
    progressFailed: shownAnswer?.failed ?? false,
    progressPending,
    refreshProgress,
    routeRide,
    refreshRides,
    lineHighlight,
  };
}
