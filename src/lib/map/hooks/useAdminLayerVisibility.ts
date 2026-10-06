import type * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

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
  const [showRoutesLayer, setShowRoutesLayer] = useState(true);
  const [showStationsLayer, setShowStationsLayer] = useState(true);
  const [showNotesLayer, setShowNotesLayer] = useState(true);
  const [showEndpointsLayer, setShowEndpointsLayer] = useState(true);
  const [showScenicLayer, setShowScenicLayer] = useState(true);
  const previousShowRoutesLayerRef = useRef(true);

  // Sync Railway Routes checkbox with the forced-hidden modes
  // biome-ignore lint/correctness/useExhaustiveDependencies: showRoutesLayer is intentionally omitted — we snapshot its current value only at the moment the mode toggles; adding it as a trigger would re-run on every checkbox change.
  useEffect(() => {
    if (hideRoutes) {
      previousShowRoutesLayerRef.current = showRoutesLayer;
      setShowRoutesLayer(false);
    } else {
      setShowRoutesLayer(previousShowRoutesLayerRef.current);
    }
  }, [hideRoutes]);

  // Apply visibility to all layers
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const setVisibility = (layerId: string, visible: boolean) => {
      if (map.current!.getLayer(layerId)) {
        map.current!.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
      }
    };

    setVisibility("railway_parts", showPartsLayer);

    const routesVisible = hideRoutes ? false : showRoutesLayer;
    setVisibility("railway_routes", routesVisible);
    setVisibility("railway_routes_heritage", routesVisible);
    setVisibility("railway_routes_special", routesVisible);
    setVisibility("railway_routes_click", routesVisible);

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
