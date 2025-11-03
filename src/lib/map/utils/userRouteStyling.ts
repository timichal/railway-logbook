import type maplibregl from 'maplibre-gl';
import { COLORS } from '@/lib/map';

/**
 * Get color expression for user railway routes based on visit status
 * Logic:
 * - If has complete trip → dark green (visited)
 * - Else if has any trip → dark orange (partial)
 * - Else → crimson (unvisited)
 */
export function getUserRouteColorExpression(): maplibregl.ExpressionSpecification {
  return [
    'case',
    // Has at least one complete trip → dark green
    ['all', ['has', 'date'], ['==', ['get', 'has_complete_trip'], true]],
    COLORS.railwayRoutes.visited,
    // Has trips but no complete trip → dark orange
    ['has', 'date'],
    COLORS.railwayRoutes.partial,
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
