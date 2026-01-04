import type maplibregl from 'maplibre-gl';
import { COLORS } from '@/lib/map';

/**
 * Get color expression for user railway routes based on visit status
 * Logic:
 * - For logged users: Uses 'date' property from tile data
 * - For unlogged users: Uses feature-state set from localStorage
 * - If has complete trip → dark green (visited)
 * - Else if has any trip → dark orange (partial)
 * - Else → crimson (unvisited)
 * Note: Scenic routes use same colors but with outline effect (separate layer)
 */
export function getUserRouteColorExpression(): maplibregl.ExpressionSpecification {
  return [
    'case',
    // Logged users: Has at least one complete trip (from tile data) → dark green
    ['all', ['has', 'date'], ['==', ['get', 'has_complete_trip'], true]],
    COLORS.railwayRoutes.visited,
    // Logged users: Has trips but no complete trip (from tile data) → dark orange
    ['has', 'date'],
    COLORS.railwayRoutes.partial,
    // Unlogged users: Has partial trip (from feature-state) → dark orange
    ['all', ['==', ['feature-state', 'hasTrip'], true], ['==', ['feature-state', 'partial'], true]],
    COLORS.railwayRoutes.partial,
    // Unlogged users: Has complete trip (from feature-state) → dark green
    ['==', ['feature-state', 'hasTrip'], true],
    COLORS.railwayRoutes.visited,
    // No trips → crimson
    COLORS.railwayRoutes.unvisited
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Get width expression for user railway routes based on usage type
 */
export function getUserRouteWidthExpression(): maplibregl.ExpressionSpecification {
  return [
    'case',
    ['==', ['get', 'usage_type'], 1],
    2,  // Special usage = thinner
    3   // Normal = standard width
  ] as maplibregl.ExpressionSpecification;
}
