import L from 'leaflet';
import { COLORS, WEIGHTS, OPACITIES, FILL_OPACITIES, ZOOM } from './mapConstants';

/**
 * Selected parts interface for styling
 */
export interface SelectedParts {
  startingId: string;
  endingId: string;
}

/**
 * Calculate style for a railway part based on selection state
 */
function calculatePartStyle(partId: string, selectedParts?: SelectedParts, zoomLevel?: number) {
  const isStartingPart = selectedParts?.startingId && partId === selectedParts.startingId;
  const isEndingPart = selectedParts?.endingId && partId === selectedParts.endingId;

  if (isStartingPart) {
    return {
      color: COLORS.PARTS_STARTING,
      weight: WEIGHTS.PARTS_SELECTED,
      opacity: OPACITIES.PARTS_SELECTED,
      fillOpacity: FILL_OPACITIES.PARTS_SELECTED,
    };
  }

  if (isEndingPart) {
    return {
      color: COLORS.PARTS_ENDING,
      weight: WEIGHTS.PARTS_SELECTED,
      opacity: OPACITIES.PARTS_SELECTED,
      fillOpacity: FILL_OPACITIES.PARTS_SELECTED,
    };
  }

  return {
    color: COLORS.PARTS_DEFAULT,
    weight: (zoomLevel || 7) < ZOOM.PARTS_THRESHOLD ? WEIGHTS.PARTS_LOW_ZOOM : WEIGHTS.PARTS_HIGH_ZOOM,
    opacity: OPACITIES.PARTS_DEFAULT,
    fillOpacity: FILL_OPACITIES.PARTS_DEFAULT,
  };
}

/**
 * Get style for railway parts
 */
export function getRailwayPartsStyle(feature?: any, selectedParts?: SelectedParts) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!feature || feature?.geometry?.type !== 'LineString') return {};

  const zoomLevel = feature.properties?.zoom_level;
  const partId = feature.properties?.['@id']?.toString();

  return calculatePartStyle(partId, selectedParts, zoomLevel);
}

/**
 * Get style for railway routes
 */
export function getRouteStyle(feature?: any, selectedRouteId?: string | null) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!feature || feature?.geometry?.type !== 'LineString') return {};

  const isSelected = selectedRouteId === feature.properties?.track_id;

  return {
    color: isSelected ? COLORS.ROUTES_SELECTED : COLORS.ROUTES_DEFAULT,
    weight: isSelected ? WEIGHTS.ROUTES_SELECTED : WEIGHTS.ROUTES_DEFAULT,
    opacity: isSelected ? OPACITIES.ROUTES_SELECTED : OPACITIES.ROUTES_DEFAULT,
    fillOpacity: FILL_OPACITIES.ROUTES,
  };
}

/**
 * Add hover effects to a layer (railway parts)
 */
export function addPartsHoverEffects(
  layer: L.Layer,
  feature: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  selectedParts?: SelectedParts
) {
  layer.on('mouseover', function(e) {
    const layer = e.target;
    layer.setStyle({
      color: COLORS.PARTS_HOVER,
      weight: WEIGHTS.PARTS_HOVER,
      opacity: OPACITIES.ROUTES_HOVER,
    });
  });

  layer.on('mouseout', function(e) {
    const layer = e.target;
    const partId = feature.properties?.['@id']?.toString();
    const zoomLevel = feature.properties?.zoom_level || 7;

    // Restore original style
    const style = calculatePartStyle(partId, selectedParts, zoomLevel);
    layer.setStyle(style);
  });
}

/**
 * Add hover effects to a layer (railway routes)
 */
export function addRoutesHoverEffects(
  layer: L.Layer,
  feature: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  selectedRouteId?: string | null
) {
  layer.on('mouseover', function(e) {
    const layer = e.target;
    layer.setStyle({
      weight: WEIGHTS.ROUTES_HOVER,
      opacity: OPACITIES.ROUTES_HOVER,
    });
  });

  layer.on('mouseout', function(e) {
    const layer = e.target;
    const isSelected = selectedRouteId === feature.properties?.track_id;

    layer.setStyle({
      color: COLORS.ROUTES_DEFAULT,
      weight: isSelected ? WEIGHTS.ROUTES_SELECTED : WEIGHTS.ROUTES_DEFAULT,
      opacity: isSelected ? OPACITIES.ROUTES_SELECTED : OPACITIES.ROUTES_DEFAULT,
    });
  });
}

/**
 * Get preview route style
 */
export function getPreviewStyle() {
  return {
    color: COLORS.PREVIEW,
    weight: WEIGHTS.PREVIEW,
    opacity: OPACITIES.PREVIEW,
  };
}
