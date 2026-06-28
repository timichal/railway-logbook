import type maplibregl from "maplibre-gl";
import { COLORS, lineClassColorExpression, WIDTHS } from "@/lib/map";

/**
 * Get color expression for user railway routes based on visit status AND line class
 * Each status (visited/partial/unvisited) has 3 shades: light (branch), medium (main), dark (highspeed)
 *
 * Logic:
 * - For logged users: Uses 'date' property from tile data
 * - For unlogged users: Uses feature-state set from localStorage
 * Note: Scenic routes use same colors but with outline effect (separate layer)
 */
export function getUserRouteColorExpression(): maplibregl.ExpressionSpecification {
  return [
    "case",
    // Logged users: Has at least one complete trip (from tile data) → green shades
    ["all", ["has", "date"], ["==", ["get", "has_complete_trip"], true]],
    lineClassColorExpression(COLORS.railwayRoutes.visited),
    // Logged users: Has trips but no complete trip (from tile data) → orange shades
    ["has", "date"],
    lineClassColorExpression(COLORS.railwayRoutes.partial),
    // Unlogged users: Has partial trip (from feature-state) → orange shades
    ["all", ["==", ["feature-state", "hasTrip"], true], ["==", ["feature-state", "partial"], true]],
    lineClassColorExpression(COLORS.railwayRoutes.partial),
    // Unlogged users: Has complete trip (from feature-state) → green shades
    ["==", ["feature-state", "hasTrip"], true],
    lineClassColorExpression(COLORS.railwayRoutes.visited),
    // No trips → red shades
    lineClassColorExpression(COLORS.railwayRoutes.unvisited),
  ] as maplibregl.ExpressionSpecification;
}

type WidthStop = { branch: number; main: number; highspeed: number };

/**
 * Per-route width chooser given a target stop. Special-usage routes (any
 * non-regular usage_type: Heritage or Special) are rendered slightly thinner
 * than branch via WIDTHS.specialUsageMultiplier.
 */
function widthByClass(stop: WidthStop): maplibregl.ExpressionSpecification {
  return [
    "case",
    ["!=", ["get", "usage_type"], 0],
    stop.branch * WIDTHS.specialUsageMultiplier,
    ["==", ["get", "line_class"], "branch"],
    stop.branch,
    ["==", ["get", "line_class"], "highspeed"],
    stop.highspeed,
    stop.main,
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Width expression for user railway routes. Single top-level zoom interpolate
 * (MapLibre only allows one zoom expression per property). All line classes
 * are visible at every zoom; widths just shrink when zoomed out.
 */
export function getUserRouteWidthExpression(): maplibregl.ExpressionSpecification {
  const s = WIDTHS.userRoute;
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    widthByClass(s.z4),
    7,
    widthByClass(s.z7),
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Width expression for the dotted Heritage layer. Heritage dots are rendered via
 * a round line-cap, so their diameter equals the line width — they're scaled by
 * WIDTHS.heritageDotMultiplier off the branch width. The heritage layer only
 * contains heritage routes, so a single branch-based width per zoom is enough
 * (no line_class branching).
 */
export function getUserRouteHeritageWidthExpression(): maplibregl.ExpressionSpecification {
  const s = WIDTHS.userRoute;
  const dotWidth = (stop: WidthStop) => stop.branch * WIDTHS.heritageDotMultiplier;
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    dotWidth(s.z4),
    7,
    dotWidth(s.z7),
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Wide transparent line used purely as a click/hover hit area so the visible
 * railway line can stay thin without becoming hard to tap on touch devices.
 */
export function getUserRouteClickBufferWidthExpression(): maplibregl.ExpressionSpecification {
  const s = WIDTHS.clickBuffer;
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    widthByClass(s.z4),
    12,
    widthByClass(s.z12),
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Admin map width expression with selected-route override. Equivalent to
 * getUserRouteWidthExpression() but constant across zoom (admin map shows all
 * line classes at every zoom) and with the selected track_id rendered at
 * WIDTHS.selectedRoute. The selection case lives inside each interpolate stop
 * because MapLibre forbids wrapping a zoom-interpolate inside another
 * expression like ['case', ...].
 */
export function getAdminRouteWidthExpression(
  selectedTrackId: number | null,
): maplibregl.ExpressionSpecification {
  const normal = widthByClass(WIDTHS.adminRoute);
  const stop =
    selectedTrackId === null
      ? normal
      : ([
          "case",
          ["==", ["id"], selectedTrackId],
          WIDTHS.selectedRoute,
          normal,
        ] as maplibregl.ExpressionSpecification);

  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    stop,
    6.5,
    stop,
    7,
    stop,
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Admin-map width for the dotted Heritage layer. Like getAdminRouteWidthExpression
 * (constant across zoom, selected track rendered at WIDTHS.selectedRoute) but the
 * non-selected width is the heritage-dot width.
 */
export function getAdminRouteHeritageWidthExpression(
  selectedTrackId: number | null,
): maplibregl.ExpressionSpecification {
  const normal = WIDTHS.adminRoute.branch * WIDTHS.heritageDotMultiplier;
  const stop =
    selectedTrackId === null
      ? normal
      : ([
          "case",
          ["==", ["id"], selectedTrackId],
          WIDTHS.selectedRoute,
          normal,
        ] as maplibregl.ExpressionSpecification);

  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    stop,
    6.5,
    stop,
    7,
    stop,
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Outline width for scenic routes — same shape as the visible width but
 * fattened by ~6px at every stop. Done as a separate top-level interpolate
 * because MapLibre disallows wrapping a zoom-interpolate inside another
 * expression like ['+', ...].
 */
export function getUserRouteScenicOutlineWidthExpression(): maplibregl.ExpressionSpecification {
  const s = WIDTHS.scenicOutline;
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    widthByClass(s.z4),
    7,
    widthByClass(s.z7),
  ] as maplibregl.ExpressionSpecification;
}
