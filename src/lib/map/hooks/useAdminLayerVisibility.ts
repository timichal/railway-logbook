import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';

interface UseAdminLayerVisibilityOptions {
  map: React.MutableRefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  isEditingGeometry?: boolean;
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
}

/**
 * Manages visibility toggles for all admin map layers.
 * Consolidates individual layer visibility useEffects and edit-geometry mode sync.
 */
export function useAdminLayerVisibility({
  map,
  mapLoaded,
  isEditingGeometry,
}: UseAdminLayerVisibilityOptions): LayerVisibilityState {
  const [showPartsLayer, setShowPartsLayer] = useState(true);
  const [showRoutesLayer, setShowRoutesLayer] = useState(true);
  const [showStationsLayer, setShowStationsLayer] = useState(true);
  const [showNotesLayer, setShowNotesLayer] = useState(true);
  const [showEndpointsLayer, setShowEndpointsLayer] = useState(true);
  const previousShowRoutesLayerRef = useRef(true);

  // Sync Railway Routes checkbox with edit geometry mode
  useEffect(() => {
    if (isEditingGeometry) {
      previousShowRoutesLayerRef.current = showRoutesLayer;
      setShowRoutesLayer(false);
    } else {
      setShowRoutesLayer(previousShowRoutesLayerRef.current);
    }
  }, [isEditingGeometry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply visibility to all layers
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const setVisibility = (layerId: string, visible: boolean) => {
      if (map.current!.getLayer(layerId)) {
        map.current!.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
    };

    setVisibility('railway_parts', showPartsLayer);

    const routesVisible = isEditingGeometry ? false : showRoutesLayer;
    setVisibility('railway_routes', routesVisible);
    setVisibility('railway_routes_scenic_outline', routesVisible);

    setVisibility('stations', showStationsLayer);
    setVisibility('admin_notes', showNotesLayer);
    setVisibility('route-endpoints', showEndpointsLayer);
  }, [
    map, mapLoaded,
    showPartsLayer, showRoutesLayer, showStationsLayer, showNotesLayer, showEndpointsLayer,
    isEditingGeometry,
  ]);

  return {
    showPartsLayer, setShowPartsLayer,
    showRoutesLayer, setShowRoutesLayer,
    showStationsLayer, setShowStationsLayer,
    showNotesLayer, setShowNotesLayer,
    showEndpointsLayer, setShowEndpointsLayer,
  };
}
