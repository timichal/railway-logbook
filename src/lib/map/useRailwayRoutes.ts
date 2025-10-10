import { useState, useCallback, useEffect } from 'react';
import L from 'leaflet';
import { GeoJSONFeatureCollection, RailwayPart } from '@/lib/types';
import { getAllRailwayRoutesWithGeometry } from '@/lib/railway-actions';
import { getRouteStyle, addRoutesHoverEffects } from './mapStyles';
import { getRoutePopup, getPreviewPartPopup } from './popupTemplates';
import { bringPreviewToFront } from './layerZOrder';
import { COLORS, WEIGHTS, OPACITIES, PREVIEW, FIT_BOUNDS_OPTIONS } from './mapConstants';

/**
 * Custom hook for managing railway routes display
 */
export function useRailwayRoutes(
  mapInstanceRef: React.RefObject<L.Map | null>,
  routesLayerGroupRef: React.RefObject<L.LayerGroup | null>,
  previewLayerGroupRef: React.RefObject<L.LayerGroup | null>,
  selectedRouteId?: string | null,
  previewRoute?: {partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[]} | null,
  refreshTrigger?: number,
  onRouteSelect?: (routeId: string) => void
) {
  const [routesData, setRoutesData] = useState<GeoJSONFeatureCollection | null>(null);

  // Function to load all railway routes
  const loadAllRoutes = useCallback(async () => {
    try {
      console.log('Loading all railway routes...');
      const routes = await getAllRailwayRoutesWithGeometry();
      setRoutesData(routes);
      console.log('Loaded', routes.features.length, 'railway routes');
    } catch (error) {
      console.error('Error loading railway routes:', error);
    }
  }, []);

  // Function to render routes layer
  const renderRoutesLayer = useCallback((routes: GeoJSONFeatureCollection) => {
    if (!mapInstanceRef.current || !routesLayerGroupRef.current) return;

    // Clear existing route layers
    routesLayerGroupRef.current.clearLayers();

    if (routes && routes.features.length > 0) {
      L.geoJSON(routes, {
        style: (feature) => getRouteStyle(feature, selectedRouteId),
        onEachFeature: (feature, layer) => {
          if (feature.geometry.type === 'LineString') {
            routesLayerGroupRef.current!.addLayer(layer);

            // Add click handler for route selection
            layer.on('click', function(e) {
              if (onRouteSelect && feature.properties?.track_id) {
                onRouteSelect(feature.properties.track_id);
              }
              L.DomEvent.stopPropagation(e);
            });

            // Add hover effects
            addRoutesHoverEffects(layer, feature, selectedRouteId);

            // Add popup with route info
            if (feature.properties) {
              const popupContent = getRoutePopup(
                feature.properties.name,
                feature.properties.track_id,
                feature.properties.primary_operator,
                feature.properties.description
              );
              layer.bindPopup(popupContent);
            }
          }
        }
      });
    }

    // After rendering routes, ensure correct z-order by re-adding preview layer
    if (mapInstanceRef.current && previewLayerGroupRef.current) {
      bringPreviewToFront(mapInstanceRef.current, previewLayerGroupRef.current);
    }
  }, [mapInstanceRef, routesLayerGroupRef, previewLayerGroupRef, selectedRouteId, onRouteSelect]);

  // Function to render preview route
  const renderPreviewRoute = useCallback((preview: {partIds: string[], coordinates: [number, number][], railwayParts: RailwayPart[]}) => {
    if (!mapInstanceRef.current || !previewLayerGroupRef.current) return;

    // Clear existing preview layers
    previewLayerGroupRef.current.clearLayers();

    console.log('AdminMap: Rendering preview route with', preview.partIds.length, 'part IDs and', preview.railwayParts.length, 'railway parts');

    if (preview.railwayParts && preview.railwayParts.length > 0) {
      const allCoordinates: [number, number][] = [];

      // Render each railway part individually (no connecting lines)
      preview.railwayParts.forEach((part, index) => {
        if (part.geometry && part.geometry.type === 'LineString') {
          const coords = part.geometry.coordinates as [number, number][];
          allCoordinates.push(...coords);

          // Create individual polyline for each railway part in the path
          const partLine = L.polyline(coords.map(coord => [coord[1], coord[0]]), {
            color: COLORS.PREVIEW,
            weight: WEIGHTS.PREVIEW,
            opacity: OPACITIES.PREVIEW,
            dashArray: PREVIEW.DASH_ARRAY
          });

          previewLayerGroupRef.current!.addLayer(partLine);

          const partId = part.properties['@id']?.toString() || 'unknown';

          // Add popup for individual parts
          const popupContent = getPreviewPartPopup(partId, index, preview.railwayParts.length);
          partLine.bindPopup(popupContent);
        }
      });

      // Fit map to preview route bounds with padding
      if (allCoordinates.length > 0) {
        const latLngs = allCoordinates.map(coord => L.latLng(coord[1], coord[0]));
        const bounds = L.latLngBounds(latLngs);
        mapInstanceRef.current.fitBounds(bounds, FIT_BOUNDS_OPTIONS.PREVIEW);
      }

      console.log('AdminMap: Highlighted', preview.railwayParts.length, 'individual railway parts for preview (no connecting lines)');
    }
  }, [mapInstanceRef, previewLayerGroupRef]);

  // Clear preview route
  const clearPreviewRoute = useCallback(() => {
    if (previewLayerGroupRef.current) {
      previewLayerGroupRef.current.clearLayers();
    }
  }, [previewLayerGroupRef]);

  // Function to focus map on selected route
  const focusOnRoute = useCallback((routeId: string) => {
    if (!mapInstanceRef.current || !routesData) return;

    const route = routesData.features.find(f => f.properties?.track_id === routeId);
    if (route && route.geometry.type === 'LineString') {
      const coordinates = route.geometry.coordinates as number[][];

      if (coordinates.length > 0) {
        // Create bounds from route coordinates
        const latLngs = coordinates.map(coord => L.latLng(coord[1], coord[0]));
        const bounds = L.latLngBounds(latLngs);

        // Fit map to route bounds with padding
        mapInstanceRef.current.fitBounds(bounds, FIT_BOUNDS_OPTIONS.ROUTE);
      }
    }
  }, [mapInstanceRef, routesData]);

  // Re-render routes when routes data or selectedRouteId changes
  useEffect(() => {
    if (routesData) {
      renderRoutesLayer(routesData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesData, selectedRouteId]);

  // Focus on route when selectedRouteId changes
  useEffect(() => {
    if (selectedRouteId && routesData) {
      focusOnRoute(selectedRouteId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRouteId, routesData]);

  // Handle preview route changes
  useEffect(() => {
    if (previewRoute) {
      renderPreviewRoute(previewRoute);
    } else {
      clearPreviewRoute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewRoute]);

  // Refresh routes when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      console.log('Refreshing routes layer due to trigger:', refreshTrigger);
      loadAllRoutes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  return {
    routesData,
    loadAllRoutes,
    renderRoutesLayer,
    renderPreviewRoute,
    clearPreviewRoute,
    focusOnRoute
  };
}
