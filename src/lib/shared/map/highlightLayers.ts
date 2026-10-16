import type {
  ExpressionSpecification,
  FilterSpecification,
  LineLayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import type { UsageType } from "../constants";
import type { ResolvedTheme } from "../theme/types";
import type { LineGeometry, PartialRouteGeometry } from "../types";
import { highlighterBandPaint, usageTypeFilter } from "./layers";
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
const HIGHLIGHT_BASE_IDS = ["highlighted_routes", "selected_routes_highlight"] as const;

interface HighlightVariant {
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
 * All overlay layer ids managed here — used on the web to include them in route
 * hit-testing. The casings are wide
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
  return casingLayer(highlightCasingLayerId(baseId, variant), color, {
    ...ROUTE_TILE,
    filter: highlightFilter(ids, variant.usageType),
  });
}

export function createHighlightLayer(
  baseId: string,
  variant: HighlightVariant,
  color: string,
  ids: number[],
): LineLayerSpecification {
  return variantLayer(highlightLayerId(baseId, variant), variant, color, {
    ...ROUTE_TILE,
    filter: highlightFilter(ids, variant.usageType),
  });
}

/** What an overlay layer draws: its source, and which of the source's features. */
interface OverlayFeatures {
  source: string;
  "source-layer"?: string;
  filter: FilterSpecification;
}

const ROUTE_TILE = { source: "railway_routes", "source-layer": "railway_routes" } as const;

function casingLayer(id: string, color: string, from: OverlayFeatures): LineLayerSpecification {
  return {
    id,
    type: "line",
    ...from,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": color,
      "line-width": WIDTHS.highlightCasing,
      "line-opacity": OPACITIES.highlightCasing,
    },
  };
}

function variantLayer(
  id: string,
  variant: HighlightVariant,
  color: string,
  from: OverlayFeatures,
  /** How an undotted line ends; a whole route leaves it to MapLibre's default. */
  cap?: "butt",
): LineLayerSpecification {
  return {
    id,
    type: "line",
    ...from,
    layout: variant.roundCap ? { "line-cap": "round" } : cap ? { "line-cap": cap } : {},
    paint: {
      "line-color": color,
      "line-width": variant.width,
      "line-opacity": OPACITIES.highlight,
      ...(variant.dash ? { "line-dasharray": variant.dash } : {}),
    },
  };
}

/**
 * The layers drawing partially-covered routes from their own geometry.
 *
 * The tile-filter overlays above can only light up whole routes, so a route covered
 * only in part — a journey plan joining it at a station between its endpoints, that
 * same route in the Route Logger selection, a ride logged in part in an opened
 * journey or trip — is excluded from them and drawn here instead. Each highlight set
 * gets its own source so the gold planner stretch and the orange selection stretch
 * don't overwrite each other.
 *
 * Split by usage type exactly as the tile overlays are — the same widths, dashes and
 * casings — so a stretch of a Heritage or Special route stays dotted or dashed. On
 * the web the casings are also what a tap on a stretch finds (see
 * `PARTIAL_HIGHLIGHT_LAYER_IDS`).
 */
export function partialHighlightSourceId(baseId: string): string {
  return `${baseId}_partial`;
}

/** The base id of one set's stretch layers: they sit under the set's source id. */
function partialBaseId(baseId: string): string {
  return partialHighlightSourceId(baseId);
}

/**
 * The stretch layers' ids, for hit-testing on the web. A stretch feature carries
 * only its route's id; the route itself is read from the tile.
 */
export const PARTIAL_HIGHLIGHT_LAYER_IDS = HIGHLIGHT_BASE_IDS.flatMap((base) =>
  highlightVariants().flatMap((v) =>
    v.casing
      ? [highlightCasingLayerId(partialBaseId(base), v), highlightLayerId(partialBaseId(base), v)]
      : [highlightLayerId(partialBaseId(base), v)],
  ),
);

/** Which stretches one variant's layer draws: those of that usage type. */
function partialHighlightFilter(usageType: number): FilterSpecification {
  return ["==", ["get", "usage_type"], usageType];
}

/** One set's stretch layers, bottom to top — each casing before its own layer. */
export function createPartialHighlightLayers(
  baseId: string,
  color: string,
): LineLayerSpecification[] {
  const base = partialBaseId(baseId);
  const source = partialHighlightSourceId(baseId);
  return highlightVariants().flatMap((v) => {
    const from = { source, filter: partialHighlightFilter(v.usageType) };
    // A stretch ends where the ride did, so a solid one ends square there
    const line = variantLayer(highlightLayerId(base, v), v, color, from, "butt");
    return v.casing ? [casingLayer(highlightCasingLayerId(base, v), color, from), line] : [line];
  });
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
      properties: { track_id: p.track_id, usage_type: p.usage_type },
      geometry: { type: "LineString", coordinates: p.coordinates },
    })),
  };
}

/** The ids of a highlight set that are covered whole, i.e. not drawn as a stretch. */
export function wholeRouteIds(ids: number[], partials: PartialRouteGeometry[]): number[] {
  const partialIds = new Set(partials.map((p) => p.track_id));
  return ids.filter((id) => !partialIds.has(id));
}

/**
 * The line picked in the map's search box, in a region that names its lines.
 *
 * Drawn as the scenic lines are — a wide, translucent, soft-edged band under the
 * route lines (`highlighterBandPaint`) — in a colour of its own, and above the scenic
 * band, so where the two meet the searched line wins. Under the routes rather than
 * over them, so what has been ridden of the line still shows.
 *
 * From a GeoJSON source of the line's merged geometry (`lineGeometryByName`), not
 * from the route tile: the tile carries one feature per route, unsimplified, and a
 * translucent band over that blots wherever two features meet and at every dense
 * vertex. The source simplifies per zoom (`LINE_SEARCH_HIGHLIGHT_TOLERANCE`), as the
 * scenic tile does in SQL. One feature per usage type, so the band can follow the
 * heritage/special switches — a layer switched off must not half-reappear as a
 * highlight round nothing.
 */
export const LINE_SEARCH_HIGHLIGHT_SOURCE_ID = "line_search_highlight";
export const LINE_SEARCH_HIGHLIGHT_LAYER_ID = "line_search_highlight";

/**
 * The GeoJSON source's simplification, in pixels of a 512px tile: the scenic tile's
 * "about a pixel per zoom" (see `scenic_lines_tile`).
 */
export const LINE_SEARCH_HIGHLIGHT_TOLERANCE = 1;

export function lineSearchHighlightData(lines: readonly LineGeometry[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: lines.map((line) => ({
      type: "Feature",
      properties: { usage_type: line.usageType },
      geometry: line.geometry,
    })),
  };
}

export function lineSearchHighlightColor(theme: ResolvedTheme): string {
  return theme === "dark" ? COLORS.lineSearchHighlightDark : COLORS.lineSearchHighlight;
}

export function createLineSearchHighlightLayer(
  usageTypes: readonly UsageType[],
  theme: ResolvedTheme = "light",
): LineLayerSpecification {
  return {
    id: LINE_SEARCH_HIGHLIGHT_LAYER_ID,
    type: "line",
    source: LINE_SEARCH_HIGHLIGHT_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": lineSearchHighlightColor(theme),
      ...highlighterBandPaint(),
      "line-opacity": OPACITIES.lineSearchHighlight,
    },
    filter: usageTypeFilter(usageTypes),
  };
}

/** Which colour a highlight set is drawn in. */
export const HIGHLIGHT_COLORS = COLORS.highlight;
