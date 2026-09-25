import type { FilterSpecification, LineLayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { CoveredStretch } from "../types";
import { lineClassColorExpression } from "./layers";
import { COLORS, OPACITIES } from "./style";
import { getUserRouteWidthExpression } from "./utils/userRouteStyling";

/**
 * The ridden-stretch overlay — what a route the user has only partly finished looks
 * like, drawn in the visited colour over its own (partial-orange) line.
 *
 * **Shared with the native app**, on the same terms as `highlightLayers.ts`: the web
 * app adds this source and layer to a live map (`useCoverageOverlay`) and the native
 * app mounts them as a `<GeoJSONSource>` with a `<Layer>` child. What the overlay
 * *is* — which colour, which width, which features it covers — is one decision and
 * lives here; only the mechanism is written twice.
 *
 * It cannot come from the route tiles: a tile carries one feature per route, and this
 * needs a piece of one. The stretches are cut from the stored fraction ranges on read
 * and handed over as GeoJSON, which is also why one code path serves logged-in users
 * and the web app's localStorage journeys alike.
 */

export const COVERAGE_SOURCE_ID = "logged_coverage";
export const COVERAGE_LAYER_ID = "logged_coverage_line";

/**
 * The stretches as drawable GeoJSON.
 *
 * `line_class` and `usage_type` ride along because they drive the same colour and
 * width expressions the base route layer uses, so the overlay lines up with the line
 * underneath; the two countries drive the same filter. The coordinates are the
 * route's own vertices, unsimplified — anything less and the overlay visibly cuts
 * corners off the line it covers.
 */
export function coverageData(stretches: CoveredStretch[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: stretches.map((s) => ({
      type: "Feature",
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
}

/**
 * Match the route layer this is drawn over: Regular usage only, and both endpoints
 * inside the selected countries. Without it the overlay would keep painting stretches
 * of routes the map is currently filtering out.
 */
export function coverageFilter(selectedCountries: string[]): FilterSpecification {
  return [
    "all",
    ["==", ["get", "usage_type"], 0],
    ["in", ["get", "start_country"], ["literal", selectedCountries]],
    ["in", ["get", "end_country"], ["literal", selectedCountries]],
  ];
}

export function createCoverageLayer(selectedCountries: string[]): LineLayerSpecification {
  return {
    id: COVERAGE_LAYER_ID,
    type: "line",
    source: COVERAGE_SOURCE_ID,
    paint: {
      "line-color": lineClassColorExpression(COLORS.railwayRoutes.visited),
      "line-width": getUserRouteWidthExpression(),
      "line-opacity": OPACITIES.defaultRoute,
    },
    filter: coverageFilter(selectedCountries),
  };
}
