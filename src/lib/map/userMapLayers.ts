import type { FilterSpecification, LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { ResolvedTheme } from "../theme/types";
import {
  createPublicNotesLayer,
  createRailwayRoutesClickLayer,
  createRailwayRoutesHeritageLayer,
  createRailwayRoutesLayer,
  createRailwayRoutesSpecialLayer,
  createScenicRoutesOutlineLayer,
  createStationLabelsLayer,
  createStationsLayer,
  type RailwayRoutesPaintConfig,
} from "./layers";
import {
  getUserRouteClickBufferWidthExpression,
  getUserRouteColorExpression,
  getUserRouteHeritageWidthExpression,
  getUserRouteScenicOutlineWidthExpression,
  getUserRouteWidthExpression,
} from "./utils/userRouteStyling";

/**
 * The user map's route layers, shared by the interactive map and the read-only
 * shared view (`/shared/<token>`).
 *
 * The route configs below are module-level constants rather than per-component
 * memos: none of them depends on anything, and a single stable reference is what `useMapTileRefresh` wants
 * anyway. Both maps must draw the same lines in the same colours — a shared map
 * that styled its routes differently from the owner's own would be a bug that
 * only shows up once someone opens the link.
 */

// Default to Regular-only (usage_type=0); the "Show heritage lines" and "Show
// special services" toggles (useLayerFilters) reveal Heritage / Special.
export const REGULAR_ONLY_FILTER: ["==", ["get", string], number] = [
  "==",
  ["get", "usage_type"],
  0,
];

export const userRouteLayerConfig: RailwayRoutesPaintConfig = {
  colorExpression: getUserRouteColorExpression(),
  widthExpression: getUserRouteWidthExpression(),
  filter: REGULAR_ONLY_FILTER,
};

// Dashed Special / dotted Heritage layers: same visit-status colors as the
// solid line, but rendered dashed / dotted. Their usage_type filter and
// hidden-by-default visibility are baked into the factories; useLayerFilters
// toggles visibility.
export const userSpecialLayerConfig: RailwayRoutesPaintConfig = {
  colorExpression: getUserRouteColorExpression(),
  widthExpression: getUserRouteWidthExpression(),
};

export const userHeritageLayerConfig: RailwayRoutesPaintConfig = {
  colorExpression: getUserRouteColorExpression(),
  widthExpression: getUserRouteHeritageWidthExpression(),
};

export const userScenicLayerConfig: RailwayRoutesPaintConfig = {
  widthExpression: getUserRouteScenicOutlineWidthExpression(),
  filter: REGULAR_ONLY_FILTER,
};

export const userClickBufferLayerConfig: RailwayRoutesPaintConfig = {
  widthExpression: getUserRouteClickBufferWidthExpression(),
  filter: REGULAR_ONLY_FILTER,
};

/**
 * What the three layer toggles do to the filters, as expressions.
 *
 * Which usage types the two clients draw is one decision with two very different
 * implementations — the web app calls `setFilter` on a live map (`useLayerFilters`),
 * the native app passes a `filter` prop to a `<Layer>` — so the *filters* live here
 * rather than in either of them. Visibility is not: "hidden" is a layout property on
 * the web and an absent child on native, and there is nothing to share in that.
 */

/**
 * The scenic outline mirrors whatever the solid line is currently drawing, which is
 * Regular plus Heritage-when-shown. Never Special: a dashed route with an amber
 * casing under it reads as a solid amber line.
 */
export function scenicOutlineFilter(showHeritage: boolean): FilterSpecification {
  return showHeritage
    ? ["all", ["==", ["get", "scenic"], true], ["!=", ["get", "usage_type"], 2]]
    : ["all", ["==", ["get", "scenic"], true], ["==", ["get", "usage_type"], 0]];
}

/**
 * Every currently-visible usage type stays clickable. Returns null — no filter at
 * all — once all three are shown, so the common case costs no per-feature test.
 *
 * Web-only in effect: the native app has no click-buffer layer, because a press
 * arrives through the source's own 44×44pt hitbox instead.
 */
export function clickBufferFilter(
  showHeritage: boolean,
  showSpecial: boolean,
): FilterSpecification | null {
  const clickable = [0]; // Regular always
  if (showHeritage) clickable.push(1);
  if (showSpecial) clickable.push(2);
  if (clickable.length === 3) return null;
  return ["match", ["get", "usage_type"], clickable, true, false] as FilterSpecification;
}

/**
 * The full layer stack of the user map, bottom to top. The click-buffer layer is
 * included on the read-only map too: it carries the hover popups (routes are
 * thin, and hovering the visible line alone is finicky), and nothing but the
 * absence of a click handler makes that map read-only.
 */
export function createUserMapLayers(theme: ResolvedTheme = "light"): LayerSpecification[] {
  return [
    createScenicRoutesOutlineLayer(userScenicLayerConfig),
    createRailwayRoutesLayer(userRouteLayerConfig),
    createRailwayRoutesHeritageLayer(userHeritageLayerConfig),
    createRailwayRoutesSpecialLayer(userSpecialLayerConfig),
    createRailwayRoutesClickLayer(userClickBufferLayerConfig),
    createStationsLayer(theme),
    createStationLabelsLayer(theme),
    // Public Usage notes render on top (route tile refresh re-inserts route
    // layers before "stations", so this stays above them).
    createPublicNotesLayer(),
  ];
}
