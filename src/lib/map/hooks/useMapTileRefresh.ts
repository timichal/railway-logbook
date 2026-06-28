import type maplibregl from "maplibre-gl";
import { useEffect, useState } from "react";
import {
  createRailwayRoutesClickLayer,
  createRailwayRoutesLayer,
  createRailwayRoutesSource,
  createRailwayRoutesSpecialLayer,
  createScenicRoutesOutlineLayer,
  type RailwayRoutesPaintConfig,
  type RailwayRoutesSourceOptions,
} from "../index";

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
  /** Paint/filter config for invisible click-buffer layer */
  clickBufferLayerConfig: RailwayRoutesPaintConfig;
  /** Paint config for the dashed Special layer */
  specialLayerConfig: RailwayRoutesPaintConfig;
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
  clickBufferLayerConfig,
  specialLayerConfig,
}: UseMapTileRefreshOptions) {
  const [cacheBuster, setCacheBuster] = useState<number>(Date.now());

  // Reload railway_routes tiles when cacheBuster changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: cacheBuster is the sole intentional trigger — this rebuilds the source/layers only on an explicit refresh. The other values are read at rebuild time but must not trigger their own rebuild.
  useEffect(() => {
    if (!map.current || !mapLoaded || !userId) return;

    const m = map.current;
    const layersToRemove = [
      "selected_routes_highlight",
      "highlighted_routes",
      "railway_routes_click",
      "railway_routes_special",
      "railway_routes",
      "railway_routes_scenic_outline",
    ];
    layersToRemove.forEach((layerId) => {
      if (m.getLayer(layerId)) m.removeLayer(layerId);
    });

    if (m.getSource("railway_routes")) m.removeSource("railway_routes");

    const sourceOptions: RailwayRoutesSourceOptions = {
      userId: userId || undefined,
      cacheBuster,
      selectedCountries,
    };

    m.addSource("railway_routes", createRailwayRoutesSource(sourceOptions));
    m.addLayer(createScenicRoutesOutlineLayer(scenicLayerConfig), "stations");
    m.addLayer(createRailwayRoutesLayer(routeLayerConfig), "stations");
    m.addLayer(createRailwayRoutesSpecialLayer(specialLayerConfig), "stations");
    m.addLayer(createRailwayRoutesClickLayer(clickBufferLayerConfig), "stations");
  }, [cacheBuster]);

  const refreshTiles = () => setCacheBuster(Date.now());

  return { cacheBuster, refreshTiles };
}
