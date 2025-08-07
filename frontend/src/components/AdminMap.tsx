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
}

export default function AdminMap({ className = '', selectedRouteId, onRouteSelect }: AdminMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const railwayLayerGroupRef = useRef<L.LayerGroup | null>(null); // Railway parts layer
  const routesLayerGroupRef = useRef<L.LayerGroup | null>(null);  // Railway routes layer
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


  // Layer visibility toggle functions
  const togglePartsLayer = () => {
    const newVisibility = !showPartsLayer;
    setShowPartsLayer(newVisibility);
    
    if (railwayLayerGroupRef.current && mapInstanceRef.current) {
      if (newVisibility) {
        // Only add if not already on map
        if (!mapInstanceRef.current.hasLayer(railwayLayerGroupRef.current)) {
          mapInstanceRef.current.addLayer(railwayLayerGroupRef.current);
        }
      } else {
        // Only remove if currently on map
        if (mapInstanceRef.current.hasLayer(railwayLayerGroupRef.current)) {
          mapInstanceRef.current.removeLayer(railwayLayerGroupRef.current);
        }
      }
    }
  };

  const toggleRoutesLayer = () => {
    const newVisibility = !showRoutesLayer;
    setShowRoutesLayer(newVisibility);
    
    if (routesLayerGroupRef.current && mapInstanceRef.current) {
      if (newVisibility) {
        // Only add if not already on map
        if (!mapInstanceRef.current.hasLayer(routesLayerGroupRef.current)) {
          mapInstanceRef.current.addLayer(routesLayerGroupRef.current);
        }
      } else {
        // Only remove if currently on map
        if (mapInstanceRef.current.hasLayer(routesLayerGroupRef.current)) {
          mapInstanceRef.current.removeLayer(routesLayerGroupRef.current);
        }
      }
    }
  };

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
  const renderAllFeatures = (viewportData: GeoJSONFeatureCollection | null) => {
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
        style: (feature) => {
          // Dynamic styling based on zoom level
          if (feature?.geometry?.type === 'LineString') {
            const zoomLevel = feature.properties?.zoom_level || 7;

            return {
              color: '#2563eb', // Blue for all railway parts
              weight: zoomLevel < 12 ? 2 : 3,
              opacity: 0.7,
              fillOpacity: 0.6
            };
          }
          return {};
        },
        onEachFeature: (feature, layer) => {
          // Add to railway layer group
          if (feature.geometry.type === 'LineString') {
            railwayLayerGroupRef.current!.addLayer(layer);

            // Add hover effects
            layer.on('mouseover', function(e) {
              const layer = e.target;
              layer.setStyle({
                color: '#dc2626', // Red on hover
                weight: 4,
                opacity: 0.9
              });
            });

            layer.on('mouseout', function(e) {
              const layer = e.target;
              const zoomLevel = feature.properties?.zoom_level || 7;
              layer.setStyle({
                color: '#2563eb', // Back to blue
                weight: zoomLevel < 12 ? 2 : 3,
                opacity: 0.7
              });
            });
          }

          // Add simple popup with basic info
          if (feature.properties) {
            const zoomLevel = feature.properties.zoom_level;

            const popupContent = `
              <div class="railway-popup">
                <h3 class="font-bold text-lg mb-2">Railway Part</h3>
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
  };

  // Function to render routes layer
  const renderRoutesLayer = (routes: GeoJSONFeatureCollection) => {
    if (!mapInstanceRef.current || !routesLayerGroupRef.current) return;

    // Clear existing route layers
    routesLayerGroupRef.current.clearLayers();

    if (routes && routes.features.length > 0) {
      L.geoJSON(routes, {
        style: (feature) => {
          if (feature?.geometry?.type === 'LineString') {
            const isSelected = selectedRouteId === feature.properties?.track_id;
            
            return {
              color: isSelected ? '#ff6b35' : '#dc2626', // Orange for selected, red for others
              weight: isSelected ? 5 : 3,
              opacity: isSelected ? 1 : 0.8,
              fillOpacity: 0.7
            };
          }
          return {};
        },
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
            layer.on('mouseover', function(e) {
              const layer = e.target;
              layer.setStyle({
                weight: 6,
                opacity: 1
              });
            });

            layer.on('mouseout', function(e) {
              const layer = e.target;
              const isSelected = selectedRouteId === feature.properties?.track_id;
              layer.setStyle({
                weight: isSelected ? 5 : 3,
                opacity: isSelected ? 1 : 0.8
              });
            });

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
  };

  // Function to focus map on selected route
  const focusOnRoute = (routeId: string) => {
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
  };

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
      }
    };
  }, [debouncedLoadData, loadDataForViewport, loadAllRoutes]); // Include dependencies

  // Re-render when viewport data changes
  useEffect(() => {
    renderAllFeatures(currentViewportData);
  }, [currentViewportData]);

  // Re-render routes when routes data changes
  useEffect(() => {
    if (routesData) {
      renderRoutesLayer(routesData);
    }
  }, [routesData, selectedRouteId]);

  // Focus on route when selectedRouteId changes
  useEffect(() => {
    if (selectedRouteId && routesData) {
      focusOnRoute(selectedRouteId);
    }
  }, [selectedRouteId, routesData]);

  // Handle layer visibility changes after map is initialized
  useEffect(() => {
    if (!mapInstanceRef.current || !railwayLayerGroupRef.current) return;

    if (showPartsLayer) {
      if (!mapInstanceRef.current.hasLayer(railwayLayerGroupRef.current)) {
        mapInstanceRef.current.addLayer(railwayLayerGroupRef.current);
      }
    } else {
      if (mapInstanceRef.current.hasLayer(railwayLayerGroupRef.current)) {
        mapInstanceRef.current.removeLayer(railwayLayerGroupRef.current);
      }
    }
  }, [showPartsLayer]);

  useEffect(() => {
    if (!mapInstanceRef.current || !routesLayerGroupRef.current) return;

    if (showRoutesLayer) {
      if (!mapInstanceRef.current.hasLayer(routesLayerGroupRef.current)) {
        mapInstanceRef.current.addLayer(routesLayerGroupRef.current);
      }
    } else {
      if (mapInstanceRef.current.hasLayer(routesLayerGroupRef.current)) {
        mapInstanceRef.current.removeLayer(routesLayerGroupRef.current);
      }
    }
  }, [showRoutesLayer]);

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
