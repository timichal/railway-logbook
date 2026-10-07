import type * as maplibregl from "maplibre-gl";
import { useEffect, useState } from "react";

interface UseAdminLayerVisibilityOptions {
  map: React.MutableRefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  /** Routes forced hidden: a geometry edit, or the Scenic lines tab (see AdminMap). */
  hideRoutes?: boolean;
}

interface LayerVisibilityState {
  showPartsLayer: boolean;
  setShowPartsLayer: React.Dispatch<React.SetStateAction<boolean>>;
  showRoutesLayer: boolean;
  setShowRoutesLayer: React.Dispatch<React.SetStateAction<boolean>>;
  showStationsLayer: boolean;
  setShowStationsLayer: React.Dispatch<React.SetStateAction<boolean>>;
  showNotesLayer: boolean;
  setShowNotesLayer: React.Dispatch<React.SetStateAction<boolean>>;
  showEndpointsLayer: boolean;
  setShowEndpointsLayer: React.Dispatch<React.SetStateAction<boolean>>;
  showScenicLayer: boolean;
  setShowScenicLayer: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Manages visibility toggles for all admin map layers.
 * Consolidates individual layer visibility useEffects and edit-geometry mode sync.
 */
export function useAdminLayerVisibility({
  map,
  mapLoaded,
  hideRoutes,
}: UseAdminLayerVisibilityOptions): LayerVisibilityState {
  const [showPartsLayer, setShowPartsLayer] = useState(true);
  const [showRoutesLayer, setShowRoutesLayer] = useState(!hideRoutes);
  const [showStationsLayer, setShowStationsLayer] = useState(true);
  const [showNotesLayer, setShowNotesLayer] = useState(true);
  const [showEndpointsLayer, setShowEndpointsLayer] = useState(true);
  const [showScenicLayer, setShowScenicLayer] = useState(true);
  const [routesHidden, setRoutesHidden] = useState(!!hideRoutes);
  const [showRoutesBeforeHide, setShowRoutesBeforeHide] = useState(true);

  // Entering a forced-hidden mode unticks Railway Routes, and leaving it puts back
  // what was ticked before. Only the default: re-ticking it mid-mode shows the routes.
  // Adjusted during render rather than in an effect, so the layer is never applied
  // with the stale value for a frame.
  if (!!hideRoutes !== routesHidden) {
    setRoutesHidden(!!hideRoutes);
    if (hideRoutes) {
      setShowRoutesBeforeHide(showRoutesLayer);
      setShowRoutesLayer(false);
    } else {
      setShowRoutesLayer(showRoutesBeforeHide);
    }
  }

  // Apply visibility to all layers
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const setVisibility = (layerId: string, visible: boolean) => {
      if (map.current!.getLayer(layerId)) {
        map.current!.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
      }
    };

    setVisibility("railway_parts", showPartsLayer);

    setVisibility("railway_routes", showRoutesLayer);
    setVisibility("railway_routes_heritage", showRoutesLayer);
    setVisibility("railway_routes_special", showRoutesLayer);
    // Routes re-shown mid-mode are for reference: the wide hit area stays off, so it
    // neither swallows the clicks on the parts being picked nor selects a route.
    setVisibility("railway_routes_click", showRoutesLayer && !hideRoutes);

    setVisibility("stations", showStationsLayer);
    setVisibility("station_labels", showStationsLayer);
    setVisibility("admin_notes", showNotesLayer);
    setVisibility("route-endpoints", showEndpointsLayer);
    setVisibility("scenic_lines", showScenicLayer);
  }, [
    map,
    mapLoaded,
    showPartsLayer,
    showRoutesLayer,
    showStationsLayer,
    showNotesLayer,
    showEndpointsLayer,
    showScenicLayer,
    hideRoutes,
  ]);

  return {
    showPartsLayer,
    setShowPartsLayer,
    showRoutesLayer,
    setShowRoutesLayer,
    showStationsLayer,
    setShowStationsLayer,
    showNotesLayer,
    setShowNotesLayer,
    showEndpointsLayer,
    setShowEndpointsLayer,
    showScenicLayer,
    setShowScenicLayer,
  };
}
