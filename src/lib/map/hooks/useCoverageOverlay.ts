import type * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { DataAccess } from "@/lib/dataAccess";
import type { UsageType } from "@/lib/shared/constants";
import {
  COVERAGE_LAYER_IDS,
  COVERAGE_SOURCE_ID,
  coverageData,
  coverageFilters,
  createCoverageLayers,
} from "@/lib/shared/map/coverageLayer";
import type { ResolvedTheme } from "@/lib/shared/theme/types";
import type { CoveredStretch } from "@/lib/shared/types";

/**
 * The stretches of unfinished routes the user has actually ridden, drawn in the
 * visited colour on top of the route's own (partial-orange) line — so a route
 * ridden halfway reads as half done instead of all-orange.
 *
 * What the overlay looks like is `map/coverageLayer.ts`, shared with the native app.
 * This hook is the live-map mechanism: add, update, restack, remove.
 */
function syncCoverageOverlay(
  m: maplibregl.Map,
  stretches: CoveredStretch[],
  selectedCountries: string[],
  shownTypes: readonly UsageType[],
  theme: ResolvedTheme,
): void {
  if (stretches.length === 0) {
    for (const id of COVERAGE_LAYER_IDS) if (m.getLayer(id)) m.removeLayer(id);
    if (m.getSource(COVERAGE_SOURCE_ID)) m.removeSource(COVERAGE_SOURCE_ID);
    return;
  }

  const data = coverageData(stretches);

  const source = m.getSource(COVERAGE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
  } else {
    m.addSource(COVERAGE_SOURCE_ID, { type: "geojson", data });
  }

  for (const layer of createCoverageLayers(selectedCountries, shownTypes, theme)) {
    if (m.getLayer(layer.id)) {
      if (layer.filter) m.setFilter(layer.id, layer.filter);
    } else {
      m.addLayer(layer as maplibregl.LayerSpecification);
    }
    // Sit above the route lines but below the stations — and therefore below the
    // selection/planner highlights, which are added on top of everything. In
    // order, so the variants keep their own stacking.
    if (m.getLayer("stations")) m.moveLayer(layer.id, "stations");
  }
}

/**
 * Keeps the ridden-stretch overlay in sync with the user's logged partial rides.
 */
export function useCoverageOverlay(
  map: React.RefObject<maplibregl.Map | null>,
  mapLoaded: boolean,
  dataAccess: DataAccess,
  selectedCountries: string[],
  /** The usage types the map draws (`shownUsageTypes`), which the overlay follows. */
  shownTypes: readonly UsageType[],
  /** Bumped when journeys change, so the overlay refetches. */
  coverageVersion: number,
  /** The visited colour's scheme. A scheme change rebuilds the map, which re-adds the layers. */
  theme: ResolvedTheme,
) {
  // Read by the fetch when it lands, so a filter change alone never refetches
  const filtersRef = useRef({ selectedCountries, shownTypes, theme });
  filtersRef.current = { selectedCountries, shownTypes, theme };

  // biome-ignore lint/correctness/useExhaustiveDependencies: coverageVersion is an intentional trigger — it refetches the stretches after journeys change.
  useEffect(() => {
    const m = map.current;
    if (!mapLoaded || !m) return;

    let cancelled = false;
    dataAccess
      .getCoveredStretches()
      .then((stretches) => {
        // A rebuild (region or scheme) while the fetch ran: the new map runs this
        // effect again for itself.
        if (cancelled || map.current !== m) return;
        // Straight in, with no isStyleLoaded() check: mapLoaded already means the
        // style is loaded, and isStyleLoaded() is false for as long as any source
        // is still fetching tiles — which is exactly when this lands after a tile
        // refresh. Its fallback, once("load"), fires once per map and so never did.
        const filters = filtersRef.current;
        syncCoverageOverlay(
          m,
          stretches,
          filters.selectedCountries,
          filters.shownTypes,
          filters.theme,
        );
      })
      .catch((error) => {
        if (!cancelled) console.error("Error loading ridden stretches:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [map, mapLoaded, dataAccess, coverageVersion]);

  // A country or layer toggle only refilters what is already there: the stretches
  // are the same, and refetching them is a server action queued behind the rest
  useEffect(() => {
    const m = map.current;
    if (!mapLoaded || !m) return;
    for (const { id, filter } of coverageFilters(selectedCountries, shownTypes)) {
      if (m.getLayer(id)) m.setFilter(id, filter);
    }
  }, [map, mapLoaded, selectedCountries, shownTypes]);
}
