'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GeoJSONFeatureCollection, GeoJSONFeature } from '@/lib/types';
import { getRailwayPartsByBounds, getAllRailwayRoutesWithGeometry } from '@/lib/railway-actions';

interface AdminMapProps {
  className?: string;
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string) => void;
  onPartClick?: (partId: string) => void;
  previewRoute?: {partIds: string[], coordinates: [number, number][]} | null;
  selectedParts?: {startingId: string, endingId: string};
}

export default function AdminMap({ className = '', selectedRouteId, onRouteSelect, onPartClick, previewRoute, selectedParts }: AdminMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const railwayLayerGroupRef = useRef<L.LayerGroup | null>(null); // Railway parts layer
  const routesLayerGroupRef = useRef<L.LayerGroup | null>(null);  // Railway routes layer
  const previewLayerGroupRef = useRef<L.LayerGroup | null>(null); // Preview route layer
  const isLoadingRef = useRef<boolean>(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  
  // Cache for features outside current viewport + current viewport data
  const cachedFeatures = useRef<Map<string, GeoJSONFeature>>(new Map()); // Features outside current viewport
  const MAX_CACHED_FEATURES = 5000;
  
  const [isLoading, setIsLoading] = useState(false);
  const [currentViewportData, setCurrentViewportData] = useState<GeoJSONFeatureCollection | null>(null);
  const [routesData, setRoutesData] = useState<GeoJSONFeatureCollection | null>(null);
  
  // Layer visibility state
  const [showPartsLayer, setShowPartsLayer] = useState(true);
  const [showRoutesLayer, setShowRoutesLayer] = useState(true);


  // Generic layer visibility toggle function
  const toggleLayer = useCallback((layerRef: React.RefObject<L.LayerGroup | null>, isVisible: boolean, setVisibility: (visible: boolean) => void) => {
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
  }, []);

  // Specific toggle functions
  const togglePartsLayer = useCallback(() => {
    toggleLayer(railwayLayerGroupRef, showPartsLayer, setShowPartsLayer);
  }, [toggleLayer, showPartsLayer]);

  const toggleRoutesLayer = useCallback(() => {
    toggleLayer(routesLayerGroupRef, showRoutesLayer, setShowRoutesLayer);
  }, [toggleLayer, showRoutesLayer]);

  // Styling functions
  const getRailwayPartsStyle = useCallback((feature?: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!feature || feature?.geometry?.type !== 'LineString') return {};
    const zoomLevel = feature.properties?.zoom_level || 7;
    const partId = feature.properties?.['@id']?.toString();
    
    // Check if this part is selected as starting or ending ID
    const isStartingPart = selectedParts?.startingId && partId === selectedParts.startingId;
    const isEndingPart = selectedParts?.endingId && partId === selectedParts.endingId;
    
    if (isStartingPart) {
      return {
        color: '#16a34a', // Green for starting part
        weight: 6,
        opacity: 1.0,
        fillOpacity: 0.8
      };
    }
    
    if (isEndingPart) {
      return {
        color: '#dc2626', // Red for ending part
        weight: 6,
        opacity: 1.0,
        fillOpacity: 0.8
      };
    }
    
    return {
      color: '#2563eb', // Blue for railway parts
      weight: zoomLevel < 12 ? 2 : 3,
      opacity: 0.7,
      fillOpacity: 0.6
    };
  }, [selectedParts]);

  const getRouteStyle = useCallback((feature?: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!feature || feature?.geometry?.type !== 'LineString') return {};
    const isSelected = selectedRouteId === feature.properties?.track_id;
    
    return {
      color: isSelected ? '#ff6b35' : '#dc2626', // Orange for selected, red for others
      weight: isSelected ? 5 : 3,
      opacity: isSelected ? 1 : 0.8,
      fillOpacity: 0.7
    };
  }, [selectedRouteId]);

  // Common hover effect function
  const addHoverEffects = useCallback((layer: L.Layer, feature: any, isRoute = false) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    layer.on('mouseover', function(e) {
      const layer = e.target;
      layer.setStyle({
        color: isRoute ? undefined : '#dc2626', // Red on hover for parts
        weight: isRoute ? 6 : 4,
        opacity: 1
      });
    });

    layer.on('mouseout', function(e) {
      const layer = e.target;
      if (isRoute) {
        const isSelected = selectedRouteId === feature.properties?.track_id;
        layer.setStyle({
          color: "#dc2626",
          weight: isSelected ? 5 : 3,
          opacity: isSelected ? 1 : 0.8
        });
      } else {
        // Restore original styling for railway parts (including selected part highlighting)
        const partId = feature.properties?.['@id']?.toString();
        const isStartingPart = selectedParts?.startingId && partId === selectedParts.startingId;
        const isEndingPart = selectedParts?.endingId && partId === selectedParts.endingId;
        const zoomLevel = feature.properties?.zoom_level || 7;
        
        if (isStartingPart) {
          layer.setStyle({
            color: '#16a34a', // Green for starting part
            weight: 6,
            opacity: 1.0
          });
        } else if (isEndingPart) {
          layer.setStyle({
            color: '#dc2626', // Red for ending part
            weight: 6,
            opacity: 1.0
          });
        } else {
          layer.setStyle({
            color: '#2563eb', // Back to blue
            weight: zoomLevel < 12 ? 2 : 3,
            opacity: 0.7
          });
        }
      }
    });
  }, [selectedRouteId, selectedParts]);

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
          if (cachedFeatures.current.size >= MAX_CACHED_FEATURES) {
            const keysToDelete = Array.from(cachedFeatures.current.keys()).slice(0, 1000); // Remove 1000 oldest
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
  }, []);

  // Debounced version of loadDataForViewport
  const debouncedLoadData = useCallback(() => {
    clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(loadDataForViewport, 500);
  }, [loadDataForViewport]);

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
        style: getRailwayPartsStyle,
        onEachFeature: (feature, layer) => {
          if (feature.geometry.type === 'LineString') {
            railwayLayerGroupRef.current!.addLayer(layer);
            addHoverEffects(layer, feature, false);
            
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
            const isStartingPart = selectedParts?.startingId && partId === selectedParts.startingId;
            const isEndingPart = selectedParts?.endingId && partId === selectedParts.endingId;
            
            let roleInfo = '';
            if (isStartingPart) {
              roleInfo = '<div class="mb-2 p-2 bg-green-100 border border-green-300 rounded"><strong class="text-green-800">🟢 STARTING PART</strong><br/><span class="text-sm text-green-700">Selected as route starting point</span></div>';
            } else if (isEndingPart) {
              roleInfo = '<div class="mb-2 p-2 bg-red-100 border border-red-300 rounded"><strong class="text-red-800">🔴 ENDING PART</strong><br/><span class="text-sm text-red-700">Selected as route ending point</span></div>';
            }

            const popupContent = `
              <div class="railway-popup">
                <h3 class="font-bold text-lg mb-2">Railway Part</h3>
                ${roleInfo}
                <div class="mb-2">
                  <strong>OSM ID:</strong> ${feature.properties['@id']}<br/>
                  <strong>Zoom Level:</strong> ${zoomLevel}<br/>
                  <span class="text-sm text-gray-600">Raw railway segment from OpenStreetMap data</span>
                </div>
              </div>
            `;
            layer.bindPopup(popupContent);
          }
        }
      });
    }
  }, [getRailwayPartsStyle, addHoverEffects, onPartClick]);

  // Function to render routes layer
  const renderRoutesLayer = useCallback((routes: GeoJSONFeatureCollection) => {
    if (!mapInstanceRef.current || !routesLayerGroupRef.current) return;

    // Clear existing route layers
    routesLayerGroupRef.current.clearLayers();

    if (routes && routes.features.length > 0) {
      L.geoJSON(routes, {
        style: getRouteStyle,
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
            addHoverEffects(layer, feature, true);

            // Add popup with route info
            if (feature.properties) {
              const popupContent = `
                <div class="route-popup">
                  <h3 class="font-bold text-lg mb-2">${feature.properties.name}</h3>
                  <div class="mb-2">
                    <strong>Track ID:</strong> ${feature.properties.track_id}<br/>
                    <strong>Operator:</strong> ${feature.properties.primary_operator}<br/>
                    ${feature.properties.description ? `<strong>Description:</strong> ${feature.properties.description}<br/>` : ''}
                    <span class="text-sm text-gray-600">Railway Route</span>
                  </div>
                </div>
              `;
              layer.bindPopup(popupContent);
            }
          }
        }
      });
    }
  }, [getRouteStyle, addHoverEffects, onRouteSelect]);

  // Function to render preview route
  const renderPreviewRoute = useCallback((preview: {partIds: string[], coordinates: [number, number][]}) => {
    if (!mapInstanceRef.current || !previewLayerGroupRef.current) return;

    // Clear existing preview layers
    previewLayerGroupRef.current.clearLayers();

    console.log('AdminMap: Rendering preview route with', preview.coordinates.length, 'coordinates');

    if (preview.coordinates.length > 1) {
      // Create a LineString feature for the preview route
      const previewLineString = L.polyline(preview.coordinates.map(coord => [coord[1], coord[0]]), {
        color: '#ff6600', // Orange color for preview
        weight: 5,
        opacity: 0.8,
        dashArray: '10, 5' // Dashed line to distinguish from regular routes
      });

      previewLayerGroupRef.current.addLayer(previewLineString);

      // Add popup with route info
      previewLineString.bindPopup(`
        <div class="preview-route-popup">
          <h3 class="font-bold text-lg mb-2">Preview Route</h3>
          <div class="mb-2">
            <strong>Part IDs:</strong> ${preview.partIds.join(' → ')}<br/>
            <strong>Segments:</strong> ${preview.partIds.length}<br/>
            <strong>Total coordinates:</strong> ${preview.coordinates.length}<br/>
            <span class="text-sm text-gray-600">Click "Preview Route" to generate this route</span>
          </div>
        </div>
      `);

      // Fit map to preview route bounds with padding
      if (preview.coordinates.length > 0) {
        const latLngs = preview.coordinates.map(coord => L.latLng(coord[1], coord[0]));
        const bounds = L.latLngBounds(latLngs);
        mapInstanceRef.current.fitBounds(bounds, { 
          padding: [50, 50],
          maxZoom: 14
        });
      }
    }
  }, []);

  // Clear preview route
  const clearPreviewRoute = useCallback(() => {
    if (previewLayerGroupRef.current) {
      previewLayerGroupRef.current.clearLayers();
    }
  }, []);

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
        mapInstanceRef.current.fitBounds(bounds, { 
          padding: [50, 50],
          maxZoom: 12
        });
      }
    }
  }, [routesData]);

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Initialize map centered on Czech Republic
    const map = L.map(mapRef.current).setView([49.5, 15.0], 7);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    mapInstanceRef.current = map;

    // Create layer group for railway parts (blue layer, bottom)
    const railwayLayerGroup = L.layerGroup();
    railwayLayerGroupRef.current = railwayLayerGroup;
    if (showPartsLayer) {
      railwayLayerGroup.addTo(map);
    }

    // Create layer group for railway routes (red layer, top)
    const routesLayerGroup = L.layerGroup();
    routesLayerGroupRef.current = routesLayerGroup;
    if (showRoutesLayer) {
      routesLayerGroup.addTo(map);
    }

    // Create layer group for preview route (orange layer, highest)
    const previewLayerGroup = L.layerGroup();
    previewLayerGroupRef.current = previewLayerGroup;
    previewLayerGroup.addTo(map); // Always add preview layer

    // Add event listeners for viewport changes
    map.on('moveend', debouncedLoadData);
    map.on('zoomend', debouncedLoadData);

    // Load initial data after a small delay
    setTimeout(loadDataForViewport, 100);
    // Load routes data
    setTimeout(loadAllRoutes, 200);

    // Cleanup function
    return () => {
      clearTimeout(debounceTimeoutRef.current);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.off('moveend', debouncedLoadData);
        mapInstanceRef.current.off('zoomend', debouncedLoadData);
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        railwayLayerGroupRef.current = null;
        routesLayerGroupRef.current = null;
        previewLayerGroupRef.current = null;
      }
    };
  }, [debouncedLoadData, loadDataForViewport, loadAllRoutes, showPartsLayer, showRoutesLayer]); // Include dependencies

  // Re-render when viewport data changes
  useEffect(() => {
    renderAllFeatures(currentViewportData);
  }, [currentViewportData, renderAllFeatures]);

  // Re-render when selected parts change (to update highlighting)
  useEffect(() => {
    renderAllFeatures(currentViewportData);
  }, [selectedParts, currentViewportData, renderAllFeatures]);

  // Re-render routes when routes data changes
  useEffect(() => {
    if (routesData) {
      renderRoutesLayer(routesData);
    }
  }, [routesData, selectedRouteId, renderRoutesLayer]);

  // Focus on route when selectedRouteId changes
  useEffect(() => {
    if (selectedRouteId && routesData) {
      focusOnRoute(selectedRouteId);
    }
  }, [selectedRouteId, routesData, focusOnRoute]);

  // Handle preview route changes
  useEffect(() => {
    if (previewRoute) {
      renderPreviewRoute(previewRoute);
    } else {
      clearPreviewRoute();
    }
  }, [previewRoute, renderPreviewRoute, clearPreviewRoute]);

  // Handle layer visibility changes after map is initialized
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Update railway parts layer visibility
    if (railwayLayerGroupRef.current) {
      const hasPartsLayer = mapInstanceRef.current.hasLayer(railwayLayerGroupRef.current);
      if (showPartsLayer && !hasPartsLayer) {
        mapInstanceRef.current.addLayer(railwayLayerGroupRef.current);
      } else if (!showPartsLayer && hasPartsLayer) {
        mapInstanceRef.current.removeLayer(railwayLayerGroupRef.current);
      }
    }

    // Update routes layer visibility
    if (routesLayerGroupRef.current) {
      const hasRoutesLayer = mapInstanceRef.current.hasLayer(routesLayerGroupRef.current);
      if (showRoutesLayer && !hasRoutesLayer) {
        mapInstanceRef.current.addLayer(routesLayerGroupRef.current);
      } else if (!showRoutesLayer && hasRoutesLayer) {
        mapInstanceRef.current.removeLayer(routesLayerGroupRef.current);
      }
    }
  }, [showPartsLayer, showRoutesLayer]);

  return (
    <div className={`${className} relative`}>
      <div ref={mapRef} className="w-full h-full" />
      
      {/* Layer Toggle Controls */}
      <div className="absolute top-4 left-4 bg-white rounded-lg shadow-lg border border-gray-200 p-3 z-[1000] min-w-[160px]">
        <div className="text-sm font-semibold text-gray-700 mb-2">Map Layers</div>
        <div className="space-y-2">
          <button
            onClick={togglePartsLayer}
            className={`flex items-center gap-2 w-full text-left p-2 rounded-md text-sm transition-colors ${
              showPartsLayer
                ? 'bg-blue-100 text-blue-800 border border-blue-300'
                : 'bg-gray-100 text-gray-600 border border-gray-300'
            }`}
          >
            <div className={`w-3 h-3 rounded-full ${showPartsLayer ? 'bg-blue-600' : 'bg-gray-400'}`}></div>
            <span>Railway Parts</span>
            <div className="text-xs text-gray-500 ml-auto">
              {showPartsLayer ? 'ON' : 'OFF'}
            </div>
          </button>
          
          <button
            onClick={toggleRoutesLayer}
            className={`flex items-center gap-2 w-full text-left p-2 rounded-md text-sm transition-colors ${
              showRoutesLayer
                ? 'bg-red-100 text-red-800 border border-red-300'
                : 'bg-gray-100 text-gray-600 border border-gray-300'
            }`}
          >
            <div className={`w-3 h-3 rounded-full ${showRoutesLayer ? 'bg-red-600' : 'bg-gray-400'}`}></div>
            <span>Railway Routes</span>
            <div className="text-xs text-gray-500 ml-auto">
              {showRoutesLayer ? 'ON' : 'OFF'}
            </div>
          </button>
        </div>
      </div>

      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute top-4 right-4 bg-white bg-opacity-90 px-3 py-2 rounded-lg shadow-lg z-[1000]">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <span className="text-sm font-medium">Loading railway data...</span>
          </div>
        </div>
      )}
    </div>
  );
}
