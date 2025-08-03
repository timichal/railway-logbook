'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GeoJSONFeature, GeoJSONFeatureCollection } from '@/lib/types';
import { updateUserRailwayData, getRailwayDataAsGeoJSON } from '@/lib/railway-actions';

const usageMap: Record<number, string> = {
  0: 'Pravidelný provoz', // Regular
  1: 'Provoz jednou denně', // OnceDaily
  2: 'Sezónní provoz', // Seasonal
  3: 'Provoz jednou týdně', // OnceWeekly
  4: 'Provoz o pracovních dnech', // Weekdays
  5: 'Provoz o víkendech', // Weekends
  6: 'Provoz při zvláštních příležitostech' // Special
};

interface RailwayMapProps {
  className?: string;
  geoJsonData: GeoJSONFeatureCollection;
  onDataRefresh?: (newData: GeoJSONFeatureCollection) => void;
}

export default function RailwayMap({ className = '', geoJsonData, onDataRefresh }: RailwayMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const stationLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const railwayLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const [editingFeature, setEditingFeature] = useState<GeoJSONFeature | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [lastRide, setLastRide] = useState('');
  const [note, setNote] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Initialize map centered on Czech Republic/Austria border region
    const map = L.map(mapRef.current).setView([49.2, 14.5], 7);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    mapInstanceRef.current = map;

    // Create layer groups for different zoom levels
    const stationLayerGroup = L.layerGroup();
    const railwayLayerGroup = L.layerGroup();
    
    stationLayerGroupRef.current = stationLayerGroup;
    railwayLayerGroupRef.current = railwayLayerGroup;

    // Add layer groups to map
    railwayLayerGroup.addTo(map);

    // Add zoom-based visibility handler for stations
    const handleZoomEnd = () => {
      const currentZoom = map.getZoom();
      if (currentZoom >= 10) {
        if (!map.hasLayer(stationLayerGroup)) {
          map.addLayer(stationLayerGroup);
        }
      } else {
        if (map.hasLayer(stationLayerGroup)) {
          map.removeLayer(stationLayerGroup);
        }
      }
    };

    map.on('zoomend', handleZoomEnd);
    handleZoomEnd(); // Set initial visibility

    // Cleanup function
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        stationLayerGroupRef.current = null;
        railwayLayerGroupRef.current = null;
      }
    };
  }, []);

  // Function to render GeoJSON data on existing map
  const renderGeoJSONData = (data: GeoJSONFeatureCollection) => {
    if (!mapInstanceRef.current || !stationLayerGroupRef.current || !railwayLayerGroupRef.current) return;

    // Clear existing layers
    stationLayerGroupRef.current.clearLayers();
    railwayLayerGroupRef.current.clearLayers();

    // Display GeoJSON data
    if (data) {
      L.geoJSON(data, {
        pointToLayer: (feature, latlng) => {
          // Create small circle markers for stations instead of default markers
          return L.circleMarker(latlng, {
            radius: 4,
            fillColor: '#ff7800',
            color: '#000',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
          });
        },
        style: (feature) => {
          // Only style LineString features (railway lines)
          if (feature?.geometry?.type === 'LineString') {
            // Dynamic weight logic: thinner (2) for Special usage, normal (3) otherwise
            const isSpecial = feature.properties.usage.includes(6);
            const weight = isSpecial ? 2 : 3;

            return {
              color: feature.properties.custom.last_ride ? 'DarkGreen' : 'Crimson',
              weight: weight,
              opacity: 0.8,
              fillOpacity: 0.6
            };
          }
          return {};
        },
        onEachFeature: (feature, layer) => {
          // Add to appropriate layer group based on geometry type
          if (feature.geometry.type === 'Point') {
            stationLayerGroupRef.current!.addLayer(layer);
          } else {
            railwayLayerGroupRef.current!.addLayer(layer);
          }

          // Add double-click handler for railway lines to show edit form
          if (feature.geometry.type === 'LineString' && feature.properties) {
            layer.on('dblclick', (e) => {
              L.DomEvent.stopPropagation(e);
              setEditingFeature(feature);
              setLastRide(feature.properties?.custom?.last_ride ? 
                new Date(feature.properties.custom.last_ride).toISOString().split('T')[0] : '');
              setNote(feature.properties?.custom?.note || '');
              setShowEditForm(true);
            });
          }

          // Add popup with railway information
          if (feature.properties) {
            const props = feature.properties as GeoJSONFeature["properties"];
            let popupContent = `<div class="railway-popup">`;

            if (props.name) {
              popupContent += `<h3 class="font-bold text-lg mb-2">${props.name}</h3>`;
            }

            if (feature.geometry.type === 'LineString') {
              const usage = props.usage!.map((type: number) => usageMap[type]).join(', ');
              let formattedDescription = `<i>${usage}, ${props.primary_operator}</i>`
              if (props.description) {
                formattedDescription += `<br /><br />${props.description}`;
              }

              if (props.custom?.last_ride) {
                formattedDescription += `<br /><br />Naposledy projeto: ${new Intl.DateTimeFormat("cs-CZ").format(props.custom.last_ride)}`;
              }
              if (props.custom?.note) {
                formattedDescription += `<br /><br />${props.custom.note}`;
              }
              popupContent += `<div class="mb-2">${formattedDescription}</div>`;
            }

            popupContent += `</div>`;

            layer.bindPopup(popupContent);
          }
        }
      });
    }
  };

  // Effect to render data when geoJsonData changes
  useEffect(() => {
    renderGeoJSONData(geoJsonData);
  }, [geoJsonData]);

  const handleSave = async (trackId: string, lastRideDate: string, noteText: string) => {
    setIsLoading(true);
    try {
      await updateUserRailwayData(1, trackId, lastRideDate || null, noteText || null);
      
      // Refresh data and update map layers without changing view
      const newData = await getRailwayDataAsGeoJSON(1);
      renderGeoJSONData(newData);
      
      // Also update parent if needed
      if (onDataRefresh) {
        onDataRefresh(newData);
      }
      
      setShowEditForm(false);
      setEditingFeature(null);
    } catch (error) {
      console.error('Error updating railway data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingFeature?.properties?.track_id) {
      await handleSave(editingFeature.properties.track_id, lastRide, note);
    }
  };

  return (
    <div className="relative w-full h-full">
      <div
        ref={mapRef}
        className={`w-full h-full ${className}`}
        style={{ height: '100%', minHeight: '400px' }}
      />
      
      {/* Edit Form Modal */}
      {showEditForm && editingFeature && (
        <div className="absolute inset-0 flex items-center justify-center z-[9999] text-black">
          <div className="bg-white p-6 rounded-lg shadow-xl border max-w-md w-full mx-4">
            <h3 className="text-lg font-bold mb-4">
              {editingFeature.properties?.name || 'Editace tratě'}
            </h3>
            
            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label htmlFor="lastRide" className="block text-sm font-medium mb-1">
                  Naposledy projeto:
                </label>
                <div className="relative">
                  <input
                    type="date"
                    id="lastRide"
                    value={lastRide}
                    onChange={(e) => setLastRide(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {lastRide && (
                    <button
                      type="button"
                      onClick={() => setLastRide('')}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                      title="Vymazat datum"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
              
              <div>
                <label htmlFor="note" className="block text-sm font-medium mb-1">
                  Poznámka:
                </label>
                <textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Volitelná poznámka..."
                />
              </div>
              
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditForm(false);
                    setEditingFeature(null);
                  }}
                  className="px-4 py-2 text-gray-600 bg-gray-200 rounded hover:bg-gray-300 cursor-pointer"
                >
                  Zrušit
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className={`px-4 py-2 text-white rounded cursor-pointer flex items-center gap-2 ${
                    isLoading 
                      ? 'bg-blue-400 cursor-not-allowed' 
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {isLoading && (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  )}
                  {isLoading ? 'Ukládám...' : 'Uložit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
