import type { FilterSpecification, LineLayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { UsageType } from "../constants";
import type { CoveredStretch } from "../types";
import { lineClassColorExpression } from "./layers";
import { COLORS, DASHES, OPACITIES } from "./style";
import {
  getUserRouteHeritageWidthExpression,
  getUserRouteWidthExpression,
} from "./utils/userRouteStyling";

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

/**
 * One layer per usage type, each drawn the way that type's route layer is — solid,
 * dotted (Heritage) or dashed (Special) — because `line-dasharray` is not
 * data-driven, and one solid overlay would fill the gaps of the line it covers: the
 * ridden half of a dashed non-JR line in Japan would read as a JR line. Same width
 * and dash as the route layer, so the overlay's dashes land on the route's.
 */
const COVERAGE_VARIANTS = [
  { id: "logged_coverage_line", usageType: 0, width: getUserRouteWidthExpression() },
  {
    id: "logged_coverage_heritage",
    usageType: 1,
    width: getUserRouteHeritageWidthExpression(),
    dash: DASHES.heritage,
    roundCap: true,
  },
  {
    id: "logged_coverage_special",
    usageType: 2,
    width: getUserRouteWidthExpression(),
    dash: DASHES.special,
  },
] as const satisfies readonly {
  id: string;
  usageType: UsageType;
  width: unknown;
  dash?: readonly number[];
  roundCap?: boolean;
}[];

/** Every overlay layer's id, bottom to top. */
export const COVERAGE_LAYER_IDS: readonly string[] = COVERAGE_VARIANTS.map((v) => v.id);

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
 * Match the route layer a variant is drawn over: its own usage type, only while the
 * map shows that type (`shownUsageTypes` — Regular, plus whichever of the
 * heritage/special layers is switched on), and both endpoints inside the selected
 * countries. Without it the overlay would keep painting stretches of routes the map
 * is currently filtering out.
 */
function coverageFilter(
  usageType: UsageType,
  selectedCountries: string[],
  shownTypes: readonly UsageType[],
): FilterSpecification {
  return [
    "all",
    ["==", ["get", "usage_type"], shownTypes.includes(usageType) ? usageType : -1],
    ["in", ["get", "start_country"], ["literal", selectedCountries]],
    ["in", ["get", "end_country"], ["literal", selectedCountries]],
  ];
}

/** Each overlay layer's filter by id, for a live map to `setFilter` without re-adding. */
export function coverageFilters(
  selectedCountries: string[],
  shownTypes: readonly UsageType[],
): { id: string; filter: FilterSpecification }[] {
  return COVERAGE_VARIANTS.map((variant) => ({
    id: variant.id,
    filter: coverageFilter(variant.usageType, selectedCountries, shownTypes),
  }));
}

/** The overlay's layers, bottom to top. */
export function createCoverageLayers(
  selectedCountries: string[],
  shownTypes: readonly UsageType[],
): LineLayerSpecification[] {
  return COVERAGE_VARIANTS.map((variant) => ({
    id: variant.id,
    type: "line",
    source: COVERAGE_SOURCE_ID,
    ...("roundCap" in variant ? { layout: { "line-cap": "round" } } : {}),
    paint: {
      "line-color": lineClassColorExpression(COLORS.railwayRoutes.visited),
      "line-width": variant.width,
      "line-opacity": OPACITIES.defaultRoute,
      ...("dash" in variant ? { "line-dasharray": [...variant.dash] } : {}),
    },
    filter: coverageFilter(variant.usageType, selectedCountries, shownTypes),
  }));
}
