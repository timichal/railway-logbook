import type * as maplibregl from "maplibre-gl";
import { useEffect } from "react";
import type { DataAccess } from "@/lib/dataAccess";
import {
  COVERAGE_LAYER_ID,
  COVERAGE_SOURCE_ID,
  coverageData,
  coverageFilter,
  createCoverageLayer,
} from "@/lib/shared/map/coverageLayer";
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
): void {
  if (stretches.length === 0) {
    if (m.getLayer(COVERAGE_LAYER_ID)) m.removeLayer(COVERAGE_LAYER_ID);
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

  if (m.getLayer(COVERAGE_LAYER_ID)) {
    m.setFilter(COVERAGE_LAYER_ID, coverageFilter(selectedCountries));
  } else {
    m.addLayer(createCoverageLayer(selectedCountries) as maplibregl.LayerSpecification);
  }

  // Sit above the route lines but below the stations — and therefore below the
  // selection/planner highlights, which are added on top of everything.
  if (m.getLayer("stations")) m.moveLayer(COVERAGE_LAYER_ID, "stations");
}

/**
 * Keeps the ridden-stretch overlay in sync with the user's logged partial rides.
 */
export function useCoverageOverlay(
  map: React.MutableRefObject<maplibregl.Map | null>,
  mapLoaded: boolean,
  dataAccess: DataAccess,
  selectedCountries: string[],
  /** Bumped when journeys change, so the overlay refetches. */
  coverageVersion: number,
) {
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
        syncCoverageOverlay(m, stretches, selectedCountries);
      })
      .catch((error) => {
        console.error("Error loading ridden stretches:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [map, mapLoaded, dataAccess, selectedCountries, coverageVersion]);
}
