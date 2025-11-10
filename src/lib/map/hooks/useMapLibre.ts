import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_CENTER, MAP_ZOOM, EUROPE_BOUNDS, createOSMBackgroundSource, createOSMBackgroundLayer } from '../index';
import { loadMapState, saveMapState } from '../mapState';

export interface UseMapLibreOptions {
  center?: [number, number];
  zoom?: number;
  sources?: Record<string, maplibregl.SourceSpecification>;
  layers?: maplibregl.LayerSpecification[];
  onLoad?: (map: maplibregl.Map) => void;
}

export interface UseMapLibreReturn {
  map: React.MutableRefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
}

/**
 * Base hook for initializing and managing a MapLibre GL JS map instance
 *
 * @param containerRef - Ref to the map container element
 * @param options - Configuration options for the map
 * @param deps - Optional dependencies array to control when map is recreated
 * @returns Object containing map ref and loaded state
 */
export function useMapLibre(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: UseMapLibreOptions = {},
  deps: React.DependencyList = []
): UseMapLibreReturn {
  const {
    center = MAP_CENTER,
    zoom = MAP_ZOOM,
    sources = {},
    layers = [],
    onLoad,
  } = options;

  const map = useRef<maplibregl.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current || map.current) return;

    // Load saved map state or use defaults
    const savedState = loadMapState();
    const initialCenter = savedState?.center || center;
    const initialZoom = savedState?.zoom || zoom;

    // Build sources object (OSM + custom sources)
    const allSources: Record<string, maplibregl.SourceSpecification> = {
      osm: createOSMBackgroundSource(),
      ...sources,
    };

    // Build layers array (background + custom layers)
    const allLayers: maplibregl.LayerSpecification[] = [
      createOSMBackgroundLayer(),
      ...layers,
    ];

    // Create map instance
    map.current = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: allSources,
        layers: allLayers,
      },
      center: initialCenter,
      zoom: initialZoom,
      minZoom: 4, // Limit minimum zoom
      maxZoom: 18, // Limit maximum zoom
      maxBounds: EUROPE_BOUNDS, // Restrict panning to Europe
      pitchWithRotate: false, // Disable rotation on right-click drag
      dragRotate: false, // Disable rotation with Ctrl+drag
    });

    // Add navigation controls
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Add geolocation control (show current location)
    map.current.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true
        },
        trackUserLocation: true,
      }),
      'top-right'
    );

    // Save map state on move or zoom
    const saveState = () => {
      if (map.current) {
        const center = map.current.getCenter();
        const zoom = map.current.getZoom();
        saveMapState({
          center: [center.lng, center.lat],
          zoom,
        });
      }
    };

    // Listen for map movements
    map.current.on('moveend', saveState);
    map.current.on('zoomend', saveState);

    // Wait for style to load
    map.current.on('load', () => {
      setMapLoaded(true);
      if (onLoad && map.current) {
        onLoad(map.current);
      }
    });

    // Cleanup on unmount
    return () => {
      if (map.current) {
        map.current.off('moveend', saveState);
        map.current.off('zoomend', saveState);
        map.current.remove();
        map.current = null;
        setMapLoaded(false);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { map, mapLoaded };
}
