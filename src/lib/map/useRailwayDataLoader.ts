import { useState, useCallback, useRef, useEffect } from 'react';
import L from 'leaflet';
import { GeoJSONFeatureCollection, GeoJSONFeature } from '@/lib/types';
import { getRailwayPartsByBounds } from '@/lib/railway-actions';
import { getRailwayPartsStyle, addPartsHoverEffects, SelectedParts } from './mapStyles';
import { getRailwayPartPopup } from './popupTemplates';
import { bringRoutesAndPreviewToFront } from './layerZOrder';
import { TIMING, CACHE } from './mapConstants';

/**
 * Custom hook for loading and rendering railway data
 */
export function useRailwayDataLoader(
  mapInstanceRef: React.RefObject<L.Map | null>,
  railwayLayerGroupRef: React.RefObject<L.LayerGroup | null>,
  routesLayerGroupRef: React.RefObject<L.LayerGroup | null>,
  previewLayerGroupRef: React.RefObject<L.LayerGroup | null>,
  debounceTimeoutRef: React.RefObject<NodeJS.Timeout | undefined>,
  selectedParts?: SelectedParts,
  onPartClick?: (partId: string) => void
) {
  const [isLoading, setIsLoading] = useState(false);
  const [currentViewportData, setCurrentViewportData] = useState<GeoJSONFeatureCollection | null>(null);
  const isLoadingRef = useRef<boolean>(false);
  const cachedFeatures = useRef<Map<string, GeoJSONFeature>>(new Map());

  // Function to load data for current viewport
  const loadDataForViewport = useCallback(async () => {
    if (!mapInstanceRef.current || isLoadingRef.current) return;

    isLoadingRef.current = true;
    setIsLoading(true);

    try {
      const map = mapInstanceRef.current;
      const bounds = {
        north: map.getBounds().getNorth(),
        south: map.getBounds().getSouth(),
        east: map.getBounds().getEast(),
        west: map.getBounds().getWest()
      };
      const zoom = map.getZoom();

      console.log('Loading data for viewport');
      const geoJsonData = await getRailwayPartsByBounds(bounds, zoom);

      // Set current viewport data (this will always be displayed)
      setCurrentViewportData(geoJsonData);

      // Add current viewport features to cache for when they move outside viewport
      for (const feature of geoJsonData.features) {
        const featureId = feature.properties?.['@id'];
        if (featureId) {
          // If cache is at limit, remove oldest features (FIFO)
          if (cachedFeatures.current.size >= CACHE.MAX_FEATURES) {
            const keysToDelete = Array.from(cachedFeatures.current.keys()).slice(0, CACHE.EVICTION_BATCH);
            keysToDelete.forEach(key => cachedFeatures.current.delete(key));
            console.log('Cache limit reached, removed', keysToDelete.length, 'oldest features');
          }

          cachedFeatures.current.set(featureId.toString(), feature);
        }
      }

      console.log('Cache now contains', cachedFeatures.current.size, 'features');
    } catch (error) {
      console.error('Error loading railway parts:', error);
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  }, [mapInstanceRef]);

  // Debounced version of loadDataForViewport
  const debouncedLoadData = useCallback(() => {
    clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(loadDataForViewport, TIMING.DEBOUNCE_VIEWPORT);
  }, [debounceTimeoutRef, loadDataForViewport]);

  // Function to render current viewport + cached features
  const renderAllFeatures = useCallback((viewportData: GeoJSONFeatureCollection | null) => {
    if (!mapInstanceRef.current || !railwayLayerGroupRef.current) return;

    // Clear existing layers
    railwayLayerGroupRef.current.clearLayers();

    // Combine current viewport features + cached features
    const allFeatures: GeoJSONFeature[] = [];

    // Add current viewport features (highest priority - always show)
    if (viewportData && viewportData.features) {
      allFeatures.push(...viewportData.features);
    }

    // Add cached features (features from previous viewports)
    const cachedFeaturesArray = Array.from(cachedFeatures.current.values());

    // Remove duplicates (current viewport features take precedence)
    const viewportIds = new Set(viewportData?.features.map(f => f.properties?.['@id']?.toString()) || []);
    const uniqueCachedFeatures = cachedFeaturesArray.filter(f =>
      !viewportIds.has(f.properties?.['@id']?.toString())
    );

    allFeatures.push(...uniqueCachedFeatures);

    console.log(`Rendering ${viewportData?.features.length || 0} viewport features + ${uniqueCachedFeatures.length} cached features`);

    if (allFeatures.length > 0) {
      const data = {
        type: 'FeatureCollection' as const,
        features: allFeatures
      };

      // Display railway parts GeoJSON data
      L.geoJSON(data, {
        style: (feature) => getRailwayPartsStyle(feature, selectedParts),
        onEachFeature: (feature, layer) => {
          if (feature.geometry.type === 'LineString') {
            railwayLayerGroupRef.current!.addLayer(layer);
            addPartsHoverEffects(layer, feature, selectedParts);

            // Add click handler for railway part selection
            layer.on('click', function(e) {
              if (onPartClick && feature.properties?.['@id']) {
                const partId = feature.properties['@id'].toString();
                onPartClick(partId);
              }
              L.DomEvent.stopPropagation(e);
            });
          }

          // Add simple popup with basic info
          if (feature.properties) {
            const zoomLevel = feature.properties.zoom_level;
            const partId = feature.properties['@id']?.toString();
            const isStartingPart = !!(selectedParts?.startingId && partId === selectedParts.startingId);
            const isEndingPart = !!(selectedParts?.endingId && partId === selectedParts.endingId);

            const popupContent = getRailwayPartPopup(
              feature.properties['@id'],
              zoomLevel,
              isStartingPart,
              isEndingPart
            );

            layer.bindPopup(popupContent);
          }
        }
      });
    }

    // After rendering parts, ensure correct z-order by re-adding layers in order
    if (mapInstanceRef.current) {
      bringRoutesAndPreviewToFront(
        mapInstanceRef.current,
        routesLayerGroupRef.current,
        previewLayerGroupRef.current
      );
    }
  }, [mapInstanceRef, railwayLayerGroupRef, routesLayerGroupRef, previewLayerGroupRef, selectedParts, onPartClick]);

  // Re-render when viewport data OR selected parts change
  useEffect(() => {
    renderAllFeatures(currentViewportData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentViewportData, selectedParts]);

  return {
    isLoading,
    currentViewportData,
    loadDataForViewport,
    debouncedLoadData,
    renderAllFeatures
  };
}
