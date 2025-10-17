'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { updateUserRailwayData, getUserProgress, type UserProgress } from '@/lib/railway-actions';
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
  0: 'Regular',
  1: 'Seasonal',
  2: 'Special'
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
  date: string | null;
  note: string | null;
  partial: boolean | null;
}

export default function VectorRailwayMap({ className = '', userId }: VectorRailwayMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [editingFeature, setEditingFeature] = useState<EditingFeature | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [partial, setPartial] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [cacheBuster, setCacheBuster] = useState(Date.now());
  const [progress, setProgress] = useState<UserProgress | null>(null);

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
            ['==', ['get', 'partial'], true],
            COLORS.railwayRoutes.partial,
            ['has', 'date'],
            COLORS.railwayRoutes.visited,
            COLORS.railwayRoutes.unvisited
          ],
          widthExpression: [
            'case',
            ['in', 2, ['get', 'usage_types']],
            2,  // Special usage = thinner
            3   // Normal = standard width
          ],
        }),
        createStationsLayer(),
      ],
    },
    [userId] // Recreate map when userId changes
  );

  // Fetch progress stats on component mount
  useEffect(() => {
    const fetchProgress = async () => {
      try {
        const progressData = await getUserProgress();
        setProgress(progressData);
      } catch (error) {
        console.error('Error fetching progress:', error);
      }
    };

    fetchProgress();
  }, []);

  // Add event handlers after map loads
  useEffect(() => {
    if (!map.current) return;

    const mapInstance = map.current;
    let currentPopup: maplibregl.Popup | null = null;

    // Add click handler for editing
    const handleClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const properties = feature.properties;

      if (!properties) return;

      // Close any open popups
      closeAllPopups();
      if (currentPopup) {
        currentPopup.remove();
        currentPopup = null;
      }

      setEditingFeature({
        track_id: properties.track_id,
        name: properties.name,
        description: properties.description,
        primary_operator: properties.primary_operator,
        usage_types: properties.usage_types,
        date: properties.date,
        note: properties.note,
        partial: properties.partial
      });

      setDate(properties.date ?
        new Date(properties.date).toISOString().split('T')[0] : '');
      setNote(properties.note || '');
      setPartial(properties.partial || false);
      setShowEditForm(true);
    };

    // Add hover handler for popups
    const handleMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) {
        if (currentPopup) {
          currentPopup.remove();
          currentPopup = null;
        }
        return;
      }

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

      if (properties.date) {
        formattedDescription += `<br /><br /><span style="color: black;">Date: ${new Intl.DateTimeFormat("cs-CZ").format(new Date(properties.date))}</span>`;
      }
      if (properties.note) {
        formattedDescription += `<br /><br /><span style="color: black;">${properties.note}</span>`;
      }

      popupContent += `<div class="mb-2">${formattedDescription}</div>`;
      popupContent += `</div>`;

      // Remove old popup if exists
      if (currentPopup) {
        currentPopup.remove();
      }

      // Create new popup
      currentPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
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
      // Remove popup when leaving the route
      if (currentPopup) {
        currentPopup.remove();
        currentPopup = null;
      }
    };

    mapInstance.on('click', 'railway_routes', handleClick);
    mapInstance.on('mousemove', 'railway_routes', handleMouseMove);
    mapInstance.on('mouseenter', 'railway_routes', handleMouseEnter);
    mapInstance.on('mouseleave', 'railway_routes', handleMouseLeave);

    // Cleanup
    return () => {
      if (currentPopup) {
        currentPopup.remove();
      }
      mapInstance.off('click', 'railway_routes', handleClick);
      mapInstance.off('mousemove', 'railway_routes', handleMouseMove);
      mapInstance.off('mouseenter', 'railway_routes', handleMouseEnter);
      mapInstance.off('mouseleave', 'railway_routes', handleMouseLeave);
    };
  }, [map]);

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFeature?.track_id) return;

    setIsLoading(true);
    try {
      await updateUserRailwayData(editingFeature.track_id, date || null, note || null, partial);

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
                ['==', ['get', 'partial'], true],
                COLORS.railwayRoutes.partial,
                ['has', 'date'],
                COLORS.railwayRoutes.visited,
                COLORS.railwayRoutes.unvisited
              ],
              widthExpression: [
                'case',
                ['in', 2, ['get', 'usage_types']],
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

      // Refresh progress stats
      try {
        const progressData = await getUserProgress();
        setProgress(progressData);
      } catch (error) {
        console.error('Error refreshing progress:', error);
      }
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

      {/* Progress Stats Box */}
      {progress && (
        <div className="absolute top-4 left-4 bg-white p-3 rounded shadow-lg text-black z-10">
          <h3 className="font-bold mb-2 text-sm">Completed</h3>
          <div className="text-lg font-semibold">
            {progress.completedKm}/{progress.totalKm} km
          </div>
          <div className="text-2xl font-bold text-green-600">
            {progress.percentage}%
          </div>
          <div className="text-xs text-gray-600 mt-1">
            {progress.completedRoutes}/{progress.totalRoutes} routes
          </div>
        </div>
      )}

      {/* Edit Form Modal */}
      {showEditForm && editingFeature && (
        <div className="absolute inset-0 flex items-center justify-center z-[9999] text-black">
          <div className="bg-white p-6 rounded-lg shadow-xl border max-w-md w-full mx-4">
            <h3 className="text-lg font-bold mb-4">
              {editingFeature.name || 'Editace tratě'}
            </h3>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label htmlFor="date" className="block text-sm font-medium mb-1">
                  Date
                </label>
                <div className="relative">
                  <input
                    type="date"
                    id="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={`w-full pl-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${date ? 'pr-6' : 'pr-3'}`}
                  />
                  {date && (
                    <button
                      type="button"
                      onClick={() => setDate('')}
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm cursor-pointer"
                      title="Clear date"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="note" className="block text-sm font-medium mb-1">
                  Note
                </label>
                <textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional note..."
                />
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={partial}
                    onChange={(e) => setPartial(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  />
                  <span className="text-sm font-medium">Partial</span>
                </label>
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
