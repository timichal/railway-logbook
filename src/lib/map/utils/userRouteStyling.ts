import type maplibregl from 'maplibre-gl';
import { COLORS } from '@/lib/map';

/**
 * Get color expression for user railway routes based on visit status
 */
export function getUserRouteColorExpression(): maplibregl.ExpressionSpecification {
  return [
    'case',
    ['==', ['get', 'partial'], true],
    COLORS.railwayRoutes.partial,
    ['has', 'date'],
    COLORS.railwayRoutes.visited,
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
