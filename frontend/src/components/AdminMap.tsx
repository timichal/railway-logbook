'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GeoJSONFeatureCollection } from '@/lib/types';
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
  const [isLoading, setIsLoading] = useState(false);
  const [currentData, setCurrentData] = useState<GeoJSONFeatureCollection | null>(null);

  // Function to load data for current viewport
  const loadDataForViewport = async () => {
    if (!mapInstanceRef.current || isLoadingRef.current) return;

    isLoadingRef.current = true;
    setIsLoading(true);
    
    try {
      const map = mapInstanceRef.current;
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      
      const geoJsonData = await getRailwayPartsByBounds({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      }, zoom);
      
      setCurrentData(geoJsonData);
    } catch (error) {
      console.error('Error loading railway parts:', error);
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  };

  // Debounced version of loadDataForViewport
  const debouncedLoadData = () => {
    clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(loadDataForViewport, 500);
  };

  // Function to render railway parts data on existing map
  const renderRailwayParts = (data: GeoJSONFeatureCollection) => {
    if (!mapInstanceRef.current || !railwayLayerGroupRef.current) return;

    // Clear existing layers
    railwayLayerGroupRef.current.clearLayers();

    // Display railway parts GeoJSON data
    if (data && data.features.length > 0) {
      L.geoJSON(data, {
        style: (feature) => {
          // Dynamic styling based on zoom level
          if (feature?.geometry?.type === 'LineString') {
            const zoomLevel = feature.properties?.zoom_level || 7;
            
            return {
              color: '#2563eb', // Blue for all railway parts
              weight: zoomLevel < 10 ? 1 : zoomLevel < 12 ? 2 : 3,
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
  }, []); // Empty dependency array - only run once

  // Re-render data when currentData changes
  useEffect(() => {
    if (currentData) {
      renderRailwayParts(currentData);
    }
  }, [currentData]);

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