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
 * Get width expression for user railway routes based on usage type and line class
 * Width hierarchy: highspeed (4) > main (3) > branch (2), Special usage always thinnest (1.5)
 */
export function getUserRouteWidthExpression(): maplibregl.ExpressionSpecification {
  return [
    'case',
    ['==', ['get', 'usage_type'], 1],
    1.5,  // Special usage = thinnest
    ['==', ['get', 'line_class'], 'branch'],
    2,    // Branch = thinner
    3.5     // Main and highspeed = standard
  ] as maplibregl.ExpressionSpecification;
}
