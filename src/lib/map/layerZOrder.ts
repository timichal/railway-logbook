import L from 'leaflet';

/**
 * Z-order management utilities for Leaflet LayerGroups
 *
 * LayerGroups don't have bringToFront(), so we use remove/re-add pattern
 * to change z-order. Layers added later appear on top.
 */

/**
 * Bring a layer to the front by removing and re-adding it
 */
export function bringLayerToFront(
  map: L.Map,
  layer: L.LayerGroup | null
): void {
  if (!layer || !map.hasLayer(layer)) return;

  map.removeLayer(layer);
  map.addLayer(layer);
}

/**
 * Ensure correct z-order: parts (bottom) -> routes (middle) -> preview (top)
 */
export function enforceLayerZOrder(
  map: L.Map,
  partsLayer: L.LayerGroup | null,
  routesLayer: L.LayerGroup | null,
  previewLayer: L.LayerGroup | null
): void {
  // Re-add layers in order to ensure correct z-order
  // Only re-add layers that are currently on the map

  if (partsLayer && map.hasLayer(partsLayer)) {
    map.removeLayer(partsLayer);
    map.addLayer(partsLayer);
  }

  if (routesLayer && map.hasLayer(routesLayer)) {
    map.removeLayer(routesLayer);
    map.addLayer(routesLayer);
  }

  if (previewLayer && map.hasLayer(previewLayer)) {
    map.removeLayer(previewLayer);
    map.addLayer(previewLayer);
  }
}

/**
 * Ensure routes and preview layers are above parts layer
 */
export function bringRoutesAndPreviewToFront(
  map: L.Map,
  routesLayer: L.LayerGroup | null,
  previewLayer: L.LayerGroup | null
): void {
  bringLayerToFront(map, routesLayer);
  bringLayerToFront(map, previewLayer);
}

/**
 * Ensure preview layer is on top of all other layers
 */
export function bringPreviewToFront(
  map: L.Map,
  previewLayer: L.LayerGroup | null
): void {
  bringLayerToFront(map, previewLayer);
}
