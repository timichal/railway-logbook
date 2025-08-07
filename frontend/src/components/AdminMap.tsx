'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GeoJSONFeatureCollection } from '@/lib/types';
// Remove the import since we'll define it locally

interface AdminMapProps {
  className?: string;
}

// Helper function to convert lat/lng to tile coordinates
function latLngToTile(lat: number, lng: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const y = Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  return { x, y };
}

// Helper function to convert lat/lng bounds to tile coordinates (client-side only)
function boundsToTiles(bounds: { north: number; south: number; east: number; west: number }, zoom: number) {
  const tiles: Array<{z: number, x: number, y: number}> = [];
  
  console.log('Converting bounds to tiles for zoom', zoom, 'bounds:', bounds);
  
  // Convert bounds to tile coordinates using standard web mercator projection
  const topLeft = latLngToTile(bounds.north, bounds.west, zoom);
  const bottomRight = latLngToTile(bounds.south, bounds.east, zoom);
  
  // Ensure we have the correct min/max values (y is inverted in tile coordinates)
  const minTileX = Math.min(topLeft.x, bottomRight.x);
  const maxTileX = Math.max(topLeft.x, bottomRight.x);
  const minTileY = Math.min(topLeft.y, bottomRight.y);
  const maxTileY = Math.max(topLeft.y, bottomRight.y);
  
  console.log(`Tile coordinates: X range ${minTileX}-${maxTileX}, Y range ${minTileY}-${maxTileY}`);
  
  // Generate list of tiles needed
  for (let x = minTileX; x <= maxTileX; x++) {
    for (let y = minTileY; y <= maxTileY; y++) {
      tiles.push({ z: zoom, x, y });
    }
  }
  
  console.log(`Generated ${tiles.length} tiles:`, tiles);
  
  return tiles;
}

// Client-side tile fetching function
async function getRailwayPartsByTiles(
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  },
  zoom: number
): Promise<GeoJSONFeatureCollection> {
  console.log('getRailwayPartsByTiles called with bounds:', bounds, 'zoom:', zoom);
  
  // Get required tiles for the bounds
  const tiles = boundsToTiles(bounds, zoom);
  
  // Use all tiles needed to cover the viewport (no arbitrary limit)
  // The tile calculation should now be accurate for the full viewport
  console.log('Tiles to fetch:', tiles.length, 'tiles for current viewport');
  
  // Fetch data from each tile
  const tilePromises = tiles.map(async ({ z, x, y }) => {
    try {
      const url = `/api/admin/tiles/${z}/${x}/${y}`;
      console.log('Fetching tile:', url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Tile fetch failed: ${response.status}`);
      const data = await response.json();
      console.log(`Tile ${z}/${x}/${y} returned ${data.features?.length || 0} features`);
      return data;
    } catch (error) {
      console.error(`Error fetching tile ${z}/${x}/${y}:`, error);
      return { type: 'FeatureCollection', features: [] };
    }
  });
  
  const tileResults = await Promise.all(tilePromises);
  
  // Combine all features from all tiles
  const allFeatures: any[] = [];
  for (const tileData of tileResults) {
    if (tileData.features) {
      allFeatures.push(...tileData.features);
    }
  }
  
  // Remove duplicate features (same @id)
  const uniqueFeatures = allFeatures.filter((feature, index, arr) => 
    arr.findIndex(f => f.properties?.['@id'] === feature.properties?.['@id']) === index
  );
  
  console.log('Final result:', uniqueFeatures.length, 'unique features');
  
  return {
    type: 'FeatureCollection',
    features: uniqueFeatures
  };
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
      console.log("blep")
      const geoJsonData = await getRailwayPartsByTiles({
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
