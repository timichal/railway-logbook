import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { MAP_CONFIG, TIMING } from './mapConstants';

/**
 * Custom hook for map initialization
 */
export function useMapInitialization(
  mapRef: React.RefObject<HTMLDivElement>,
  showPartsLayer: boolean,
  showRoutesLayer: boolean,
  onViewportChange: () => void,
  onInitialLoad: () => void,
  onRoutesLoad: () => void
) {
  const mapInstanceRef = useRef<L.Map | null>(null);
  const railwayLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const routesLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const previewLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Initialize map
    const map = L.map(mapRef.current).setView(
      MAP_CONFIG.INITIAL_CENTER,
      MAP_CONFIG.INITIAL_ZOOM
    );

    // Add OpenStreetMap tiles
    L.tileLayer(MAP_CONFIG.TILE_URL, {
      attribution: MAP_CONFIG.TILE_ATTRIBUTION
    }).addTo(map);

    mapInstanceRef.current = map;

    // Create layer groups (order matters for z-index - last added appears on top)

    // Railway parts layer (blue layer, bottom)
    const railwayLayerGroup = L.layerGroup();
    railwayLayerGroupRef.current = railwayLayerGroup;

    // Railway routes layer (red layer, middle)
    const routesLayerGroup = L.layerGroup();
    routesLayerGroupRef.current = routesLayerGroup;

    // Preview route layer (orange layer, top)
    const previewLayerGroup = L.layerGroup();
    previewLayerGroupRef.current = previewLayerGroup;

    // Add layers in order: parts (bottom), routes (middle), preview (top)
    if (showPartsLayer) {
      railwayLayerGroup.addTo(map);
    }
    if (showRoutesLayer) {
      routesLayerGroup.addTo(map);
    }
    previewLayerGroup.addTo(map); // Always add preview layer last (on top)

    // Cleanup function
    return () => {
      clearTimeout(debounceTimeoutRef.current);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        railwayLayerGroupRef.current = null;
        routesLayerGroupRef.current = null;
        previewLayerGroupRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Set up event listeners after initialization
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const map = mapInstanceRef.current;

    // Add event listeners for viewport changes
    map.on('moveend', onViewportChange);
    map.on('zoomend', onViewportChange);

    // Load initial data after a small delay
    const initialLoadTimeout = setTimeout(onInitialLoad, TIMING.INITIAL_DATA_LOAD);
    const routesLoadTimeout = setTimeout(onRoutesLoad, TIMING.INITIAL_ROUTES_LOAD);

    // Cleanup event listeners
    return () => {
      clearTimeout(initialLoadTimeout);
      clearTimeout(routesLoadTimeout);
      map.off('moveend', onViewportChange);
      map.off('zoomend', onViewportChange);
    };
  }, [onViewportChange, onInitialLoad, onRoutesLoad]);

  return {
    mapInstanceRef,
    railwayLayerGroupRef,
    routesLayerGroupRef,
    previewLayerGroupRef,
    debounceTimeoutRef
  };
}
