import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataAccess } from "@/lib/dataAccess";
import {
  createPublicNotesSource,
  createPublicStationsSource,
  createRailwayRoutesSource,
  createScenicLinesSource,
  railwayRoutesTileUrl,
} from "@/lib/map";
import { useCoverageOverlay } from "@/lib/map/hooks/useCoverageOverlay";
import { useLayerFilters } from "@/lib/map/hooks/useLayerFilters";
import { useLineSearchHighlight } from "@/lib/map/hooks/useLineSearchHighlight";
import { useMapLibre } from "@/lib/map/hooks/useMapLibre";
import { useSourceTileRefresh } from "@/lib/map/hooks/useSourceTileRefresh";
import { useLayerPrefs } from "@/lib/map/layerPrefsContext";
import type { UserProgress } from "@/lib/progressQueries";
import { useRegion } from "@/lib/regionContext";
import type { UsageType } from "@/lib/shared/constants";
import type { RouteTileRides } from "@/lib/shared/map/tileSources";
import { createUserMapLayers, shownUsageTypes } from "@/lib/shared/map/userMapLayers";
import { countedUsageTypes, regionCountryCodes } from "@/lib/shared/regions";
import { useResolvedTheme } from "@/lib/theme";

/** A number per data access, for the route tiles' refresh signal. */
const dataAccessIds = new WeakMap<DataAccess, number>();
let lastDataAccessId = 0;
function dataAccessId(dataAccess: DataAccess): number {
  let id = dataAccessIds.get(dataAccess);
  if (id === undefined) {
    id = ++lastDataAccessId;
    dataAccessIds.set(dataAccess, id);
  }
  return id;
}

interface UseUserMapOptions {
  /**
   * Whose numbers, ridden stretches and route tile colours: the session,
   * localStorage or a share token. A new one is a new owner — another account
   * reloads the route tiles even where their URL stays the same — so memoise it on
   * who it is, not on objects that are replaced without that changing.
   */
  dataAccess: DataAccess;
  /** The country filter as stored, before a single-country region pins it. */
  selectedCountries: string[];
  /**
   * Whose rides colour the route tiles: the session's or a share token's. Omitted,
   * they are Martin's, every route unvisited (an anonymous visitor's rides are laid
   * on as feature state by the caller).
   */
  rides?: RouteTileRides;
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
 * the sources and layers, the route tiles' refreshes, the progress figures, the
 * ridden stretches, the layer switches and the searched line. What either adds on
 * top (selection, highlights, interactions) stays with it.
 */
export function useUserMap(
  mapContainer: React.RefObject<HTMLDivElement | null>,
  {
    dataAccess,
    selectedCountries,
    rides,
    coverageVersion = 0,
    lineHighlightHidden = false,
    progressFollowsLayers = true,
  }: UseUserMapOptions,
) {
  const region = useRegion();
  const layerPrefs = useLayerPrefs();

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

  // The route tiles' `v`. A map rebuilt for a region or scheme change has to carry
  // the latest one, or it would be back on a URL from before the last refresh — a
  // stale tile, the moment anything caches them.
  const routesCacheBusterRef = useRef<number | undefined>(undefined);

  // The route source is the one thing here that changes without the map being
  // rebuilt: a login, a logout, a country checkbox or a logged ride only point it at
  // new tiles (`setTiles`), since rebuilding would throw away the WebGL context and
  // the basemap to change one source. So its inputs are the refresh signal: the URL
  // can't change without its tiles being reloaded, and nothing outside has to keep
  // the two in step. Beside them, a counter for a ride logged (`refreshTiles`), and
  // the data access, which stands for whose rides: a session tile's URL doesn't name
  // its user, so going from one account straight to another changes nothing else.
  const [refreshCount, setRefreshCount] = useState(0);
  const ridesKey = rides === undefined ? "" : rides === "session" ? "session" : rides.shareToken;
  const routesSignal = [
    refreshCount,
    dataAccessId(dataAccess),
    ridesKey,
    effectiveCountries.join(","),
  ].join("|");

  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      region: region.id,
      sources: () => {
        // Runs once the map is being built, well after this render has declared it
        routesSourceBuilt(routesSignal);
        // A tile coloured by someone's rides has a `v` from its first request:
        // without one its URL would be the same across page loads, and for the
        // session across everyone who signs in on this browser. Martin's tile is the
        // same for everyone and gets none until a refresh needs one, so it stays
        // cacheable.
        if (rides) routesCacheBusterRef.current ??= Date.now();
        return {
          railway_routes: createRailwayRoutesSource({
            rides,
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

  const routesSourceBuilt = useSourceTileRefresh({
    map,
    mapLoaded,
    sourceId: "railway_routes",
    signal: routesSignal,
    cacheBusterRef: routesCacheBusterRef,
    tileUrl: (cacheBuster) =>
      railwayRoutesTileUrl({ rides, cacheBuster, selectedCountries: effectiveCountries }),
  });
  // Stable identity: consumers list it in effect/callback dependency arrays.
  const refreshTiles = useCallback(() => setRefreshCount((count) => count + 1), []);

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

  // Ridden stretches of routes not yet finished, drawn over the route line
  useCoverageOverlay(
    map,
    mapLoaded,
    dataAccess,
    effectiveCountries,
    shownTypes,
    coverageVersion,
    theme,
  );

  // mapLoaded applies the persisted switches once the layers exist
  useLayerFilters(
    map,
    shownTypes,
    // The stored preference is shared across regions; one that offers no scenic
    // lines keeps them off regardless of what the other region left switched on.
    layerPrefs.showScenicLines && region.hasScenicHighlight,
    effectiveCountries,
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
    progress: shownAnswer?.progress ?? null,
    progressFailed: shownAnswer?.failed ?? false,
    progressPending,
    refreshProgress,
    refreshTiles,
    lineHighlight,
  };
}
