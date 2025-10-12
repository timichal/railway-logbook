'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { updateUserRailwayData } from '@/lib/railway-actions';
import { useMapLibre } from '@/lib/map/hooks/useMapLibre';
import {
  createRailwayRoutesSource,
  createRailwayRoutesLayer,
  createStationsSource,
  createStationsLayer,
  closeAllPopups,
  COLORS,
} from '@/lib/map';

const usageMap: Record<number, string> = {
  0: 'Pravidelný provoz',
  1: 'Provoz jednou denně',
  2: 'Sezónní provoz',
  3: 'Provoz jednou týdně',
  4: 'Provoz o pracovních dnech',
  5: 'Provoz o víkendech',
  6: 'Provoz při zvláštních příležitostech'
};

interface VectorRailwayMapProps {
  className?: string;
  userId: number;
}

interface EditingFeature {
  track_id: string;
  name: string;
  description: string;
  primary_operator: string;
  usage_types: string;
  last_ride: string | null;
  note: string | null;
}

export default function VectorRailwayMap({ className = '', userId }: VectorRailwayMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [editingFeature, setEditingFeature] = useState<EditingFeature | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [lastRide, setLastRide] = useState('');
  const [note, setNote] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(Date.now());

  // Initialize map with shared hook
  const { map } = useMapLibre(
    mapContainer,
    {
      sources: {
        railway_routes: createRailwayRoutesSource({ userId, cacheBuster }),
        stations: createStationsSource(),
      },
      layers: [
        createRailwayRoutesLayer({
          colorExpression: [
            'case',
            ['has', 'last_ride'],
            COLORS.railwayRoutes.visited,
            COLORS.railwayRoutes.unvisited
          ],
          widthExpression: [
            'case',
            ['in', 6, ['get', 'usage_types']],
            2,  // Special usage = thinner
            3   // Normal = standard width
          ],
        }),
        createStationsLayer(),
      ],
    },
    [userId] // Recreate map when userId changes
  );

  // Add event handlers after map loads
  useEffect(() => {
    if (!map.current) return;

    const mapInstance = map.current;

    // Add double-click handler for railway routes
    const handleDoubleClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const properties = feature.properties;

      if (!properties) return;

      // Prevent default map zoom
      e.preventDefault();

      // Close any open popups
      closeAllPopups();

      setEditingFeature({
        track_id: properties.track_id,
        name: properties.name,
        description: properties.description,
        primary_operator: properties.primary_operator,
        usage_types: properties.usage_types,
        last_ride: properties.last_ride,
        note: properties.note
      });

      setLastRide(properties.last_ride ?
        new Date(properties.last_ride).toISOString().split('T')[0] : '');
      setNote(properties.note || '');
      setShowEditForm(true);
    };

    // Add click handler for popups
    const handleClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const properties = feature.properties;

      if (!properties) return;

      // Parse usage_types array
      let usage = 'N/A';
      try {
        let usageTypes: number[] = [];

        if (properties.usage_types) {
          if (Array.isArray(properties.usage_types)) {
            usageTypes = properties.usage_types;
          } else if (typeof properties.usage_types === 'string') {
            const str = properties.usage_types.trim();
            if (str.startsWith('{') && str.endsWith('}')) {
              const inner = str.slice(1, -1).trim();
              usageTypes = (inner && inner.length > 0) ? inner.split(',').map((s: string) => parseInt(s.trim())) : [];
            } else if (str.startsWith('[') && str.endsWith(']')) {
              usageTypes = JSON.parse(str);
            }
          } else if (typeof properties.usage_types === 'number') {
            usageTypes = [properties.usage_types];
          }
        }

        usage = usageTypes.map((type: number) => usageMap[type] || type).join(', ') || 'N/A';
      } catch (e) {
        console.error('Error parsing usage_types:', e, 'Value:', properties.usage_types);
      }

      let popupContent = `<div class="railway-popup" style="color: black;">`;

      if (properties.name) {
        popupContent += `<h3 class="font-bold text-lg mb-2" style="color: black;">${properties.name}</h3>`;
      }

      let formattedDescription = `<i style="color: black;">${usage}, ${properties.primary_operator}</i>`;
      if (properties.description) {
        formattedDescription += `<br /><br /><span style="color: black;">${properties.description}</span>`;
      }

      if (properties.last_ride) {
        formattedDescription += `<br /><br /><span style="color: black;">Naposledy projeto: ${new Intl.DateTimeFormat("cs-CZ").format(new Date(properties.last_ride))}</span>`;
      }
      if (properties.note) {
        formattedDescription += `<br /><br /><span style="color: black;">${properties.note}</span>`;
      }

      popupContent += `<div class="mb-2">${formattedDescription}</div>`;
      popupContent += `</div>`;

      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(popupContent)
        .addTo(mapInstance);
    };

    // Add cursor change on hover
    const handleMouseEnter = () => {
      mapInstance.getCanvas().style.cursor = 'pointer';
    };

    const handleMouseLeave = () => {
      mapInstance.getCanvas().style.cursor = '';
    };

    mapInstance.on('dblclick', 'railway_routes', handleDoubleClick);
    mapInstance.on('click', 'railway_routes', handleClick);
    mapInstance.on('mouseenter', 'railway_routes', handleMouseEnter);
    mapInstance.on('mouseleave', 'railway_routes', handleMouseLeave);

    // Cleanup
    return () => {
      mapInstance.off('dblclick', 'railway_routes', handleDoubleClick);
      mapInstance.off('click', 'railway_routes', handleClick);
      mapInstance.off('mouseenter', 'railway_routes', handleMouseEnter);
      mapInstance.off('mouseleave', 'railway_routes', handleMouseLeave);
    };
  }, [map]);

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFeature?.track_id) return;

    setIsLoading(true);
    try {
      await updateUserRailwayData(editingFeature.track_id, lastRide || null, note || null);

      // Update cache buster to force tile reload
      const newCacheBuster = Date.now();
      setCacheBuster(newCacheBuster);

      // Refresh the map by reloading the railway routes layer with cache buster
      if (map.current) {
        const source = map.current.getSource('railway_routes') as maplibregl.VectorTileSource;
        if (source) {
          // Force reload by removing and re-adding the source with new cache buster
          map.current.removeLayer('railway_routes');
          map.current.removeSource('railway_routes');

          map.current.addSource('railway_routes', createRailwayRoutesSource({ userId, cacheBuster: newCacheBuster }));

          map.current.addLayer(
            createRailwayRoutesLayer({
              colorExpression: [
                'case',
                ['has', 'last_ride'],
                COLORS.railwayRoutes.visited,
                COLORS.railwayRoutes.unvisited
              ],
              widthExpression: [
                'case',
                ['in', 6, ['get', 'usage_types']],
                2,
                3
              ],
            }),
            'stations'
          );

          // Wait for the source to load new tiles before closing the form
          await new Promise<void>((resolve) => {
            const checkSourceLoaded = () => {
              const newSource = map.current?.getSource('railway_routes') as maplibregl.VectorTileSource;
              if (newSource) {
                setTimeout(() => resolve(), 300);
              } else {
                resolve();
              }
            };

            map.current?.once('sourcedata', checkSourceLoaded);
            setTimeout(() => resolve(), 500);
          });
        }
      }

      closeAllPopups();
      setShowEditForm(false);
      setEditingFeature(null);
    } catch (error) {
      console.error('Error updating railway data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative w-full h-full">
      <div
        ref={mapContainer}
        className={`w-full h-full ${className}`}
        style={{ height: '100%', minHeight: '400px' }}
      />

      {/* Edit Form Modal */}
      {showEditForm && editingFeature && (
        <div className="absolute inset-0 flex items-center justify-center z-[9999] text-black">
          <div className="bg-white p-6 rounded-lg shadow-xl border max-w-md w-full mx-4">
            <h3 className="text-lg font-bold mb-4">
              {editingFeature.name || 'Editace tratě'}
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
                    className={`w-full pl-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${lastRide ? 'pr-6' : 'pr-3'}`}
                  />
                  {lastRide && (
                    <button
                      type="button"
                      onClick={() => setLastRide('')}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm cursor-pointer"
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
                    closeAllPopups();
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
