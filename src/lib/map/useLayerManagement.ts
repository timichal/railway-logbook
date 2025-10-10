import { useState, useCallback, useEffect } from 'react';
import L from 'leaflet';
import { bringRoutesAndPreviewToFront, bringPreviewToFront } from './layerZOrder';

/**
 * Custom hook for managing layer visibility
 */
export function useLayerManagement(
  mapInstanceRef: React.RefObject<L.Map | null>,
  railwayLayerGroupRef: React.RefObject<L.LayerGroup | null>,
  routesLayerGroupRef: React.RefObject<L.LayerGroup | null>,
  previewLayerGroupRef: React.RefObject<L.LayerGroup | null>,
  isPreviewMode?: boolean
) {
  const [showPartsLayer, setShowPartsLayer] = useState(true);
  const [showRoutesLayer, setShowRoutesLayer] = useState(true);

  // Generic layer visibility toggle function
  const toggleLayer = useCallback(
    (
      layerRef: React.RefObject<L.LayerGroup | null>,
      isVisible: boolean,
      setVisibility: (visible: boolean) => void
    ) => {
      const newVisibility = !isVisible;
      setVisibility(newVisibility);

      if (layerRef.current && mapInstanceRef.current) {
        if (newVisibility) {
          if (!mapInstanceRef.current.hasLayer(layerRef.current)) {
            mapInstanceRef.current.addLayer(layerRef.current);
          }
        } else {
          if (mapInstanceRef.current.hasLayer(layerRef.current)) {
            mapInstanceRef.current.removeLayer(layerRef.current);
          }
        }
      }
    },
    [mapInstanceRef]
  );

  // Specific toggle functions
  const togglePartsLayer = useCallback(() => {
    toggleLayer(railwayLayerGroupRef, showPartsLayer, setShowPartsLayer);
  }, [toggleLayer, railwayLayerGroupRef, showPartsLayer]);

  const toggleRoutesLayer = useCallback(() => {
    toggleLayer(routesLayerGroupRef, showRoutesLayer, setShowRoutesLayer);
  }, [toggleLayer, routesLayerGroupRef, showRoutesLayer]);

  // Handle layer visibility changes after map is initialized
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Update railway parts layer visibility - hide when in preview mode
    if (railwayLayerGroupRef.current) {
      const hasPartsLayer = mapInstanceRef.current.hasLayer(railwayLayerGroupRef.current);
      const shouldShowParts = showPartsLayer && !isPreviewMode;

      if (shouldShowParts && !hasPartsLayer) {
        mapInstanceRef.current.addLayer(railwayLayerGroupRef.current);
        // Ensure correct z-order by re-adding routes and preview on top
        bringRoutesAndPreviewToFront(
          mapInstanceRef.current,
          routesLayerGroupRef.current,
          previewLayerGroupRef.current
        );
      } else if (!shouldShowParts && hasPartsLayer) {
        mapInstanceRef.current.removeLayer(railwayLayerGroupRef.current);
      }
    }

    // Update routes layer visibility
    if (routesLayerGroupRef.current) {
      const hasRoutesLayer = mapInstanceRef.current.hasLayer(routesLayerGroupRef.current);
      if (showRoutesLayer && !hasRoutesLayer) {
        mapInstanceRef.current.addLayer(routesLayerGroupRef.current);
        // Ensure preview stays on top
        bringPreviewToFront(mapInstanceRef.current, previewLayerGroupRef.current);
      } else if (!showRoutesLayer && hasRoutesLayer) {
        mapInstanceRef.current.removeLayer(routesLayerGroupRef.current);
      }
    }
  }, [
    mapInstanceRef,
    railwayLayerGroupRef,
    routesLayerGroupRef,
    previewLayerGroupRef,
    showPartsLayer,
    showRoutesLayer,
    isPreviewMode
  ]);

  return {
    showPartsLayer,
    showRoutesLayer,
    togglePartsLayer,
    toggleRoutesLayer
  };
}
