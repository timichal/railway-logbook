import type * as maplibregl from "maplibre-gl";
import { useEffect } from "react";
import type { DataAccess } from "@/lib/dataAccess";
import { COLORS, lineClassColorExpression, OPACITIES } from "@/lib/map";
import type { CoveredStretch } from "@/lib/types";
import { getUserRouteWidthExpression } from "../utils/userRouteStyling";

const COVERAGE_SOURCE_ID = "logged_coverage";
const COVERAGE_LAYER_ID = "logged_coverage_line";

/**
 * The stretches of unfinished routes the user has actually ridden, drawn in the
 * visited colour on top of the route's own (partial-orange) line — so a route
 * ridden halfway reads as half done instead of all-orange.
 *
 * These can't come from the route tiles: a tile carries one feature per route,
 * and this needs a piece of one. They are cut from the stored fraction ranges on
 * read (`getCoveredStretches`) and drawn as GeoJSON, which also means the same
 * code path serves logged-in users and localStorage journeys.
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

  const data: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: stretches.map((s) => ({
      type: "Feature",
      // line_class and usage_type drive the same colour/width expressions the
      // base route layer uses, so the overlay lines up with the line underneath;
      // the countries drive the same filter
      properties: {
        track_id: s.track_id,
        line_class: s.line_class,
        usage_type: s.usage_type,
        start_country: s.start_country,
        end_country: s.end_country,
      },
      geometry: { type: "LineString", coordinates: s.coordinates },
    })),
  };

  // Match the route layer this is drawn over: Regular-usage only, and both
  // endpoints inside the selected countries. Without this the overlay would keep
  // painting stretches of routes the map is currently filtering out.
  const filter: maplibregl.FilterSpecification = [
    "all",
    ["==", ["get", "usage_type"], 0],
    ["in", ["get", "start_country"], ["literal", selectedCountries]],
    ["in", ["get", "end_country"], ["literal", selectedCountries]],
  ];

  const source = m.getSource(COVERAGE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) {
    source.setData(data);
  } else {
    m.addSource(COVERAGE_SOURCE_ID, { type: "geojson", data });
  }

  if (m.getLayer(COVERAGE_LAYER_ID)) {
    m.setFilter(COVERAGE_LAYER_ID, filter);
  } else {
    m.addLayer({
      id: COVERAGE_LAYER_ID,
      type: "line",
      source: COVERAGE_SOURCE_ID,
      paint: {
        "line-color": lineClassColorExpression(COLORS.railwayRoutes.visited),
        "line-width": getUserRouteWidthExpression(),
        "line-opacity": OPACITIES.defaultRoute,
      },
      filter,
    });
  }

  // Sit above the route lines but below the stations — and therefore below the
  // selection/planner highlights, which are added on top of everything. A tile
  // refresh re-inserts the route layers before "stations", so this has to be
  // re-asserted rather than set once.
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
  /** Bumped when the route layers are recreated, so the overlay is re-stacked. */
  tileRefreshKey: number,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: tileRefreshKey is an intentional trigger — it re-runs the effect so the overlay is moved back above the recreated route layers.
  useEffect(() => {
    if (!mapLoaded) return;

    let cancelled = false;
    dataAccess
      .getCoveredStretches()
      .then((stretches) => {
        const m = map.current;
        if (cancelled || !m) return;

        // Changing the country selection tears the map down and builds a new one
        // (useMapLibre keys on it), so by the time this resolves the style may be
        // mid-load — adding a source to it then throws.
        if (m.isStyleLoaded()) {
          syncCoverageOverlay(m, stretches, selectedCountries);
        } else {
          m.once("load", () => {
            if (!cancelled) syncCoverageOverlay(m, stretches, selectedCountries);
          });
        }
      })
      .catch((error) => {
        console.error("Error loading ridden stretches:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [map, mapLoaded, dataAccess, selectedCountries, coverageVersion, tileRefreshKey]);
}
