import { useEffect, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import {
  createRailwayRoutesSource,
  createRailwayRoutesLayer,
  createScenicRoutesOutlineLayer,
  type RailwayRoutesSourceOptions,
  type RailwayRoutesPaintConfig,
} from '../index';

interface UseMapTileRefreshOptions {
  map: React.MutableRefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  /** Logged-in user ID (null for unlogged users) */
  userId: number | null;
  selectedCountries: string[];
  /** Paint/filter config for route layers */
  routeLayerConfig: RailwayRoutesPaintConfig;
  /** Paint/filter config for scenic outline layer */
  scenicLayerConfig: RailwayRoutesPaintConfig;
}

/**
 * Manages railway routes tile refresh (cache busting).
 * Returns `refreshTiles()` to trigger a tile reload and `cacheBuster` state.
 */
export function useMapTileRefresh({
  map,
  mapLoaded,
  userId,
  selectedCountries,
  routeLayerConfig,
  scenicLayerConfig,
}: UseMapTileRefreshOptions) {
  const [cacheBuster, setCacheBuster] = useState<number>(Date.now());

  // Reload railway_routes tiles when cacheBuster changes
  useEffect(() => {
    if (!map.current || !mapLoaded || !userId) return;

    const m = map.current;
    const layersToRemove = ['selected_routes_highlight', 'highlighted_routes', 'railway_routes', 'railway_routes_scenic_outline'];
    layersToRemove.forEach(layerId => {
      if (m.getLayer(layerId)) m.removeLayer(layerId);
    });

    if (m.getSource('railway_routes')) m.removeSource('railway_routes');

    const sourceOptions: RailwayRoutesSourceOptions = {
      userId: userId || undefined,
      cacheBuster,
      selectedCountries,
    };

    m.addSource('railway_routes', createRailwayRoutesSource(sourceOptions));
    m.addLayer(createScenicRoutesOutlineLayer(scenicLayerConfig), 'stations');
    m.addLayer(createRailwayRoutesLayer(routeLayerConfig), 'stations');
  }, [cacheBuster]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshTiles = () => setCacheBuster(Date.now());

  return { cacheBuster, refreshTiles };
}
