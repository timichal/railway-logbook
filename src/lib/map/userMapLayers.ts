import type * as maplibregl from "maplibre-gl";
import type { ResolvedTheme } from "@/lib/theme";
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
} from "./index";
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
 * The full layer stack of the user map, bottom to top. The click-buffer layer is
 * included on the read-only map too: it carries the hover popups (routes are
 * thin, and hovering the visible line alone is finicky), and nothing but the
 * absence of a click handler makes that map read-only.
 */
export function createUserMapLayers(
  theme: ResolvedTheme = "light",
): maplibregl.LayerSpecification[] {
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
