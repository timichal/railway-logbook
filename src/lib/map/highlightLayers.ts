import type {
  ExpressionSpecification,
  FilterSpecification,
  LineLayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import type { PartialRouteGeometry } from "../types";
import { COLORS, DASHES, OPACITIES, WIDTHS } from "./style";
import {
  getUserRouteHeritageWidthExpression,
  getUserRouteWidthExpression,
} from "./utils/userRouteStyling";

/**
 * What a highlighted route looks like — the overlay layers for one highlight set.
 *
 * **Shared with the native app.** The web app adds and removes these layers on a
 * live map (`useRouteHighlighting`) and the native app mounts them as `<Layer>`
 * children; what a highlight *is* — which sublayers, which widths, which dashes,
 * which colour — is one decision, and it lives here so the two cannot drift into
 * highlighting differently. Only the mechanism is written twice.
 *
 * A highlight set is drawn as one overlay sublayer per usage type rather than as a
 * single fat line, so a highlighted Heritage or Special route keeps its dots or
 * dashes instead of being buried: the dotted and dashed overlays reuse the exact
 * width and dash of the base route layers (a dasharray is in line-width multiples,
 * so matching the width is what makes the highlight's dashes land on the route's).
 */

/** The two highlight sets: the planner/view overlay and the Route Logger selection. */
export const HIGHLIGHT_BASE_IDS = ["highlighted_routes", "selected_routes_highlight"] as const;

export type HighlightBaseId = (typeof HIGHLIGHT_BASE_IDS)[number];

export interface HighlightVariant {
  suffix: "regular" | "heritage" | "special";
  usageType: number;
  width: ExpressionSpecification | number;
  dash?: [number, number];
  roundCap?: boolean;
  /** Draw a translucent solid line of the highlight colour underneath (see below). */
  casing?: boolean;
}

export function highlightVariants(): HighlightVariant[] {
  return [
    // Regular: fat solid line (solid, so no dash alignment to worry about).
    { suffix: "regular", usageType: 0, width: WIDTHS.selectedRoute },
    // Heritage: dotted, matching the base heritage layer's width + dash so dots align.
    {
      suffix: "heritage",
      usageType: 1,
      width: getUserRouteHeritageWidthExpression(),
      dash: [...DASHES.heritage],
      roundCap: true,
      casing: true,
    },
    // Special: dashed, matching the base special layer's width + dash.
    {
      suffix: "special",
      usageType: 2,
      width: getUserRouteWidthExpression(),
      dash: [...DASHES.special],
      casing: true,
    },
  ];
}

/** Ids of both layers of one variant, in the order they must be stacked. */
export function highlightLayerId(baseId: string, variant: HighlightVariant): string {
  return `${baseId}_${variant.suffix}`;
}

export function highlightCasingLayerId(baseId: string, variant: HighlightVariant): string {
  return `${highlightLayerId(baseId, variant)}_casing`;
}

/**
 * All overlay layer ids managed here — used on the web to remove them before a
 * source rebuild and to include them in route hit-testing. The casings are wide
 * and solid, which also gives Heritage and Special routes the generous hit area
 * that `railway_routes_click` provides for Regular ones.
 */
export const HIGHLIGHT_LAYER_IDS = HIGHLIGHT_BASE_IDS.flatMap((base) =>
  highlightVariants().flatMap((v) =>
    v.casing
      ? [highlightCasingLayerId(base, v), highlightLayerId(base, v)]
      : [highlightLayerId(base, v)],
  ),
);

/** Which features one variant's overlay covers: this set's ids, of that usage type. */
export function highlightFilter(ids: number[], usageType: number): FilterSpecification {
  return ["all", ["in", ["id"], ["literal", ids]], ["==", ["get", "usage_type"], usageType]];
}

/**
 * The translucent solid casing under a dashed or dotted highlight.
 *
 * Matching the route's own dash and width is what keeps the type readable, but it
 * also means the highlight covers as little of the map as the route does — a thin
 * dashed orange line over a thin dashed red one, which is barely a difference at
 * all. The casing restores the "this one is selected" reading along the whole
 * length, while the dashes on top, at full opacity, still say which type it is.
 * It must be stacked *below* its variant's own layer.
 */
export function createHighlightCasingLayer(
  baseId: string,
  variant: HighlightVariant,
  color: string,
  ids: number[],
): LineLayerSpecification {
  return {
    id: highlightCasingLayerId(baseId, variant),
    type: "line",
    source: "railway_routes",
    "source-layer": "railway_routes",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": color,
      "line-width": WIDTHS.highlightCasing,
      "line-opacity": OPACITIES.highlightCasing,
    },
    filter: highlightFilter(ids, variant.usageType),
  };
}

export function createHighlightLayer(
  baseId: string,
  variant: HighlightVariant,
  color: string,
  ids: number[],
): LineLayerSpecification {
  return {
    id: highlightLayerId(baseId, variant),
    type: "line",
    source: "railway_routes",
    "source-layer": "railway_routes",
    layout: variant.roundCap ? { "line-cap": "round" } : {},
    paint: {
      "line-color": color,
      "line-width": variant.width,
      "line-opacity": OPACITIES.highlight,
      ...(variant.dash ? { "line-dasharray": variant.dash } : {}),
    },
    filter: highlightFilter(ids, variant.usageType),
  };
}

/**
 * The layer drawing a partially-covered route from its own geometry.
 *
 * The tile-filter overlays above can only light up whole routes, so a route covered
 * only in part — a journey plan joining it at a station between its endpoints, or
 * that same route sitting in the Route Logger selection — is excluded from them and
 * drawn here instead, in the same colour and width. Each highlight set gets its own
 * source so the gold planner stretch and the orange selection stretch don't
 * overwrite each other.
 */
export function partialHighlightSourceId(baseId: string): string {
  return `${baseId}_partial`;
}

export function partialHighlightLayerId(baseId: string): string {
  return `${partialHighlightSourceId(baseId)}_line`;
}

export function createPartialHighlightLayer(baseId: string, color: string): LineLayerSpecification {
  return {
    id: partialHighlightLayerId(baseId),
    type: "line",
    source: partialHighlightSourceId(baseId),
    layout: { "line-cap": "butt" },
    paint: {
      "line-color": color,
      "line-width": WIDTHS.selectedRoute,
      "line-opacity": OPACITIES.highlight,
    },
  };
}

/**
 * The covered stretches as drawable GeoJSON. The coordinates are the route's own
 * vertices, unsimplified: anything less and the overlay visibly cuts corners off
 * the line underneath.
 */
export function partialHighlightData(partials: PartialRouteGeometry[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: partials.map((p) => ({
      type: "Feature",
      id: p.track_id,
      properties: { track_id: p.track_id },
      geometry: { type: "LineString", coordinates: p.coordinates },
    })),
  };
}

/** The ids of a highlight set that are covered whole, i.e. not drawn as a stretch. */
export function wholeRouteIds(ids: number[], partials: PartialRouteGeometry[]): number[] {
  const partialIds = new Set(partials.map((p) => p.track_id));
  return ids.filter((id) => !partialIds.has(id));
}

/** Which colour a highlight set is drawn in. */
export const HIGHLIGHT_COLORS = COLORS.highlight;
