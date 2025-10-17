import type maplibregl from 'maplibre-gl';
import { COLORS } from '@/lib/map';

type MapLibreExpression = string | number | unknown[];

interface StyleParams {
  hoveredPartId: string | null;
  startingId?: string;
  endingId?: string;
  isPreviewActive: boolean;
}

/**
 * Build MapLibre expressions for railway parts styling
 */
export function buildRailwayPartsStyleExpressions(params: StyleParams) {
  const { hoveredPartId, startingId, endingId, isPreviewActive } = params;
  const hasAnyCondition = !isPreviewActive && !!(hoveredPartId || startingId || endingId);

  // Build color expression
  let colorExpr: MapLibreExpression;
  if (hasAnyCondition) {
    const expr: unknown[] = ['case'];

    // Hover state (highest priority)
    if (hoveredPartId) {
      expr.push(['==', ['get', 'id'], hoveredPartId], COLORS.railwayParts.hover);
    }

    // Starting part (green)
    if (startingId) {
      expr.push(['==', ['get', 'id'], parseInt(startingId)], COLORS.railwayParts.selected);
    }

    // Ending part (red)
    if (endingId) {
      expr.push(['==', ['get', 'id'], parseInt(endingId)], COLORS.railwayParts.hover);
    }

    // Default blue
    expr.push(COLORS.railwayParts.default);
    colorExpr = expr;
  } else {
    colorExpr = COLORS.railwayParts.default;
  }

  // Build weight expression
  let weightExpr: MapLibreExpression;
  if (hasAnyCondition) {
    const expr: unknown[] = ['case'];

    if (startingId) {
      expr.push(['==', ['get', 'id'], parseInt(startingId)], 6);
    }
    if (endingId) {
      expr.push(['==', ['get', 'id'], parseInt(endingId)], 6);
    }
    if (hoveredPartId) {
      expr.push(['==', ['get', 'id'], hoveredPartId], 4);
    }

    expr.push(3); // Default
    weightExpr = expr;
  } else {
    weightExpr = 3;
  }

  // Build opacity expression
  let opacityExpr: MapLibreExpression;
  if (startingId || endingId) {
    const expr: unknown[] = ['case'];

    if (startingId) {
      expr.push(['==', ['get', 'id'], parseInt(startingId)], 1.0);
    }
    if (endingId) {
      expr.push(['==', ['get', 'id'], parseInt(endingId)], 1.0);
    }

    expr.push(0.7); // Default
    opacityExpr = expr;
  } else {
    opacityExpr = 0.7;
  }

  return { colorExpr, weightExpr, opacityExpr };
}

/**
 * Apply styling to railway parts layer
 */
export function applyRailwayPartsStyling(
  map: maplibregl.Map,
  params: StyleParams
) {
  const { colorExpr, weightExpr, opacityExpr } = buildRailwayPartsStyleExpressions(params);

  map.setPaintProperty('railway_parts', 'line-color', colorExpr);
  map.setPaintProperty('railway_parts', 'line-width', weightExpr);
  map.setPaintProperty('railway_parts', 'line-opacity', opacityExpr);
}
