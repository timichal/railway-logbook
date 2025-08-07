'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GeoJSONFeatureCollection, GeoJSONFeature } from '@/lib/types';
import { getRailwayPartsByBounds } from '@/lib/railway-actions';

interface AdminMapProps {
  className?: string;
}

export default function AdminMap({ className = '' }: AdminMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const railwayLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const isLoadingRef = useRef<boolean>(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  
  // Cache for features outside current viewport + current viewport data
  const cachedFeatures = useRef<Map<string, GeoJSONFeature>>(new Map()); // Features outside current viewport
  const MAX_CACHED_FEATURES = 5000;
  
  const [isLoading, setIsLoading] = useState(false);
  const [currentViewportData, setCurrentViewportData] = useState<GeoJSONFeatureCollection | null>(null);

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

    // Create layer group for railway parts
    const railwayLayerGroup = L.layerGroup();
    railwayLayerGroupRef.current = railwayLayerGroup;
    railwayLayerGroup.addTo(map);

    // Add event listeners for viewport changes
    map.on('moveend', debouncedLoadData);
    map.on('zoomend', debouncedLoadData);

    // Load initial data after a small delay
    setTimeout(loadDataForViewport, 100);

    // Cleanup function
    return () => {
      clearTimeout(debounceTimeoutRef.current);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.off('moveend', debouncedLoadData);
        mapInstanceRef.current.off('zoomend', debouncedLoadData);
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        railwayLayerGroupRef.current = null;
      }
    };
  }, [debouncedLoadData, loadDataForViewport]); // Include dependencies

  // Re-render when viewport data changes
  useEffect(() => {
    renderAllFeatures(currentViewportData);
  }, [currentViewportData]);

  return (
    <div className={`${className} relative`}>
      <div ref={mapRef} className="w-full h-full" />
      {isLoading && (
        <div className="absolute top-4 right-4 bg-white bg-opacity-90 px-3 py-2 rounded-lg shadow-lg">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <span className="text-sm font-medium">Loading railway data...</span>
          </div>
        </div>
      )}
    </div>
  );
}
