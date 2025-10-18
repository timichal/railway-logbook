import { COLORS } from '@/lib/map';

/**
 * Get color expression for user railway routes based on visit status
 */
export function getUserRouteColorExpression() {
  return [
    'case',
    ['==', ['get', 'partial'], true],
    COLORS.railwayRoutes.partial,
    ['has', 'date'],
    COLORS.railwayRoutes.visited,
    COLORS.railwayRoutes.unvisited
  ];
}

/**
 * Get width expression for user railway routes based on usage type
 */
export function getUserRouteWidthExpression() {
  return [
    'case',
    ['==', ['get', 'usage_type'], 2],
    2,  // Special usage = thinner
    3   // Normal = standard width
  ];
}
