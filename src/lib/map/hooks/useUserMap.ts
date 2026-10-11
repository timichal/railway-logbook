import type * as maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataAccess } from "@/lib/dataAccess";
import {
  createPublicNotesSource,
  createPublicStationsSource,
  createScenicLinesSource,
} from "@/lib/map";
import { useCoverageOverlay } from "@/lib/map/hooks/useCoverageOverlay";
import { useLayerFilters } from "@/lib/map/hooks/useLayerFilters";
import { useLineSearchHighlight } from "@/lib/map/hooks/useLineSearchHighlight";
import { useMapLibre } from "@/lib/map/hooks/useMapLibre";
import { useLayerPrefs } from "@/lib/map/layerPrefsContext";
import type { UserProgress } from "@/lib/progressQueries";
import { useRegion } from "@/lib/regionContext";
import { createUserMapLayers, shownUsageTypes } from "@/lib/shared/map/userMapLayers";
import { regionCountryCodes } from "@/lib/shared/regions";
import { useResolvedTheme } from "@/lib/theme";

interface UseUserMapOptions {
  /** Whose numbers and ridden stretches: the session, localStorage or a share token. */
  dataAccess: DataAccess;
  /** The country filter as stored, before a single-country region pins it. */
  selectedCountries: string[];
  /**
   * The `railway_routes` source, given the countries it opens on. Called once per
   * map, at construction, as `useMapLibre`'s factories are.
   */
  routesSource: (countries: string[]) => maplibregl.SourceSpecification;
  /** What rebuilds the map besides the region and the scheme, which always do. */
  rebuildOn?: React.DependencyList;
  /** Bumped when journeys change, to refetch the ridden-stretch overlay. */
  coverageVersion?: number;
  /** Stands the searched-line band down — see `useLineSearchHighlight`. */
  lineHighlightHidden?: boolean;
}

/**
 * The map both user maps draw — the signed-in or anonymous one and the shared one:
 * the sources and layers, the progress figures, the ridden stretches, the layer
 * switches and the searched line. What either adds on top (selection, highlights,
 * tile refreshes, interactions) stays with it.
 */
export function useUserMap(
  mapContainer: React.RefObject<HTMLDivElement | null>,
  {
    dataAccess,
    selectedCountries,
    routesSource,
    rebuildOn = [],
    coverageVersion = 0,
    lineHighlightHidden = false,
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

  // The station dots and their labels are picked against the basemap under them, so
  // they follow the scheme. useMapLibre rebuilds the map when it changes.
  const theme = useResolvedTheme();

  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      region: region.id,
      sources: () => ({
        railway_routes: routesSource(effectiveCountries),
        stations: createPublicStationsSource(),
        scenic_lines: createScenicLinesSource(),
        public_notes: createPublicNotesSource(),
      }),
      layers: () => createUserMapLayers(theme),
    },
    [region.id, ...rebuildOn],
  );

  // Each answer is kept with the data access it was asked of, and shown only while
  // that is still the current one: a region switch or a login replaces it, and the
  // rebuilt map sends nothing until it has loaded, so the old answer could otherwise
  // still land after the switch and show the other region's numbers
  const [answer, setAnswer] = useState<{ from: DataAccess; progress: UserProgress } | null>(null);
  const progress = answer?.from === dataAccess ? answer.progress : null;
  // Only the newest request's answer is kept: toggling countries fast sends
  // several, and they need not come back in order
  const progressRequest = useRef(0);
  const refreshProgress = useCallback(async () => {
    const request = ++progressRequest.current;
    try {
      const next = await dataAccess.getUserProgress(effectiveCountries);
      if (request === progressRequest.current) setAnswer({ from: dataAccess, progress: next });
    } catch (error) {
      console.error("Error refreshing progress:", error);
    }
  }, [dataAccess, effectiveCountries]);

  useEffect(() => {
    if (mapLoaded) void refreshProgress();
  }, [mapLoaded, refreshProgress]);

  // Ridden stretches of routes not yet finished, drawn over the route line
  useCoverageOverlay(map, mapLoaded, dataAccess, effectiveCountries, coverageVersion);

  // mapLoaded applies the persisted switches once the layers exist
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

  // The line picked in the search box, highlighted on the map
  const shownTypes = useMemo(
    () => shownUsageTypes(layerPrefs.showHeritage, layerPrefs.showSpecial),
    [layerPrefs.showHeritage, layerPrefs.showSpecial],
  );
  const lineHighlight = useLineSearchHighlight(
    map,
    mapLoaded,
    region.id,
    shownTypes,
    lineHighlightHidden,
  );

  return { map, mapLoaded, effectiveCountries, progress, refreshProgress, lineHighlight };
}
