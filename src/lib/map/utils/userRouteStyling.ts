import type maplibregl from 'maplibre-gl';
import { COLORS, lineClassColorExpression } from '@/lib/map';

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
    'case',
    // Logged users: Has at least one complete trip (from tile data) → green shades
    ['all', ['has', 'date'], ['==', ['get', 'has_complete_trip'], true]],
    lineClassColorExpression(COLORS.railwayRoutes.visited),
    // Logged users: Has trips but no complete trip (from tile data) → orange shades
    ['has', 'date'],
    lineClassColorExpression(COLORS.railwayRoutes.partial),
    // Unlogged users: Has partial trip (from feature-state) → orange shades
    ['all', ['==', ['feature-state', 'hasTrip'], true], ['==', ['feature-state', 'partial'], true]],
    lineClassColorExpression(COLORS.railwayRoutes.partial),
    // Unlogged users: Has complete trip (from feature-state) → green shades
    ['==', ['feature-state', 'hasTrip'], true],
    lineClassColorExpression(COLORS.railwayRoutes.visited),
    // No trips → red shades
    lineClassColorExpression(COLORS.railwayRoutes.unvisited)
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Per-route width chooser given a target stop width — used inside the
 * zoom interpolate stops below. Branch/special width is supplied separately
 * so we can hide them entirely at low zoom by passing 0.
 */
function widthByClass(
  branchOrSpecial: number,
  main: number,
  highspeed: number,
): maplibregl.ExpressionSpecification {
  return [
    'case',
    ['==', ['get', 'usage_type'], 1], branchOrSpecial * 0.85, // Special slightly thinner than branch
    ['==', ['get', 'line_class'], 'branch'], branchOrSpecial,
    ['==', ['get', 'line_class'], 'highspeed'], highspeed,
    main
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Width expression for user railway routes. Single top-level zoom interpolate
 * (MapLibre only allows one zoom expression per property). Branch + special
 * routes have width 0 below zoom 7 so the zoomed-out map shows only main +
 * highspeed lines.
 */
export function getUserRouteWidthExpression(): maplibregl.ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['zoom'],
    4,    widthByClass(0, 0.6, 0.8),
    6.5,  widthByClass(0, 1.3, 1.5),
    7,   widthByClass(2, 2.5, 3)
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Wide transparent line used purely as a click/hover hit area so the visible
 * railway line can stay thin without becoming hard to tap on touch devices.
 * Width is 0 below zoom 7 for branch/special so phantom hidden lines don't
 * catch clicks; constant 16 for main/highspeed once visible.
 */
export function getUserRouteClickBufferWidthExpression(): maplibregl.ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['zoom'],
    4,   widthByClass(0, 14, 14),
    6.5, widthByClass(0, 14, 14),
    7,   widthByClass(14, 14, 14),
    12,  widthByClass(16, 16, 16)
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Admin map width expression with selected-route override. Equivalent to
 * getUserRouteWidthExpression() but with the selected track_id rendered at
 * a constant ~5px so it stands out. The selection case lives inside each
 * interpolate stop because MapLibre forbids wrapping a zoom-interpolate
 * inside another expression like ['case', ...].
 */
export function getAdminRouteWidthExpression(
  selectedTrackId: number | null
): maplibregl.ExpressionSpecification {
  if (selectedTrackId === null) {
    return getUserRouteWidthExpression();
  }
  const SELECTED_WIDTH = 5;
  const sel = (
    normal: maplibregl.ExpressionSpecification | number
  ): maplibregl.ExpressionSpecification =>
    ['case', ['==', ['id'], selectedTrackId], SELECTED_WIDTH, normal] as maplibregl.ExpressionSpecification;

  return [
    'interpolate', ['linear'], ['zoom'],
    4,    sel(widthByClass(0, 0.6, 0.8)),
    6.5,  sel(widthByClass(0, 1.3, 1.5)),
    7,    sel(widthByClass(2, 2.5, 3))
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Outline width for scenic routes — same shape as the visible width but
 * fattened by ~6px at every stop. Done as a separate top-level interpolate
 * because MapLibre disallows wrapping a zoom-interpolate inside another
 * expression like ['+', ...].
 */
export function getUserRouteScenicOutlineWidthExpression(): maplibregl.ExpressionSpecification {
  return [
    'interpolate', ['linear'], ['zoom'],
    4,    widthByClass(0, 6.6, 6.8),
    6.5,  widthByClass(0, 7.3, 7.5),
    7,   widthByClass(8, 8.5, 9)
  ] as maplibregl.ExpressionSpecification;
}
