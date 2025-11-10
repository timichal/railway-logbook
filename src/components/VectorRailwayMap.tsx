'use client';

import { useEffect, useRef, useState } from 'react';
import type { FilterSpecification } from 'maplibre-gl';
import type { Station } from '@/lib/types';
import { useMapLibre } from '@/lib/map/hooks/useMapLibre';
import { useStationSearch } from '@/lib/map/hooks/useStationSearch';
import { useRouteEditor } from '@/lib/map/hooks/useRouteEditor';
import {
  createRailwayRoutesSource,
  createRailwayRoutesLayer,
  createStationsSource,
  createStationsLayer,
} from '@/lib/map';
import { setupUserMapInteractions } from '@/lib/map/interactions/userMapInteractions';
import { getUserRouteColorExpression, getUserRouteWidthExpression } from '@/lib/map/utils/userRouteStyling';
import MultiRouteLogger from './MultiRouteLogger';
import TripRow from './TripRow';

interface VectorRailwayMapProps {
  className?: string;
  userId: number;
}

export default function VectorRailwayMap({ className = '', userId }: VectorRailwayMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);

  // Multi-route logger state
  const [showMultiRouteLogger, setShowMultiRouteLogger] = useState(false);
  const [highlightedRoutes, setHighlightedRoutes] = useState<number[]>([]);

  // Station search hook
  const stationSearch = useStationSearch();

  // Initialize map with shared hook
  const { map } = useMapLibre(
    mapContainer,
    {
      sources: {
        railway_routes: createRailwayRoutesSource({ userId, cacheBuster: Date.now() }),
        stations: createStationsSource(),
      },
      layers: [
        createRailwayRoutesLayer({
          colorExpression: getUserRouteColorExpression(),
          widthExpression: getUserRouteWidthExpression(),
          filter: ['!=', ['get', 'usage_type'], 1], // Hide special routes by default (matches showSpecialLines initial state)
        }),
        createStationsLayer(),
      ],
    },
    [userId]
  );

  // Route editor hook (needs map ref)
  const routeEditor = useRouteEditor(userId, map);

  // Setup map interactions after map loads
  useEffect(() => {
    if (!map.current) return;

    const cleanup = setupUserMapInteractions(map.current, {
      onRouteClick: routeEditor.openEditForm,
      onQuickLog: routeEditor.quickLog,
      onRefreshAfterQuickLog: routeEditor.refreshAfterQuickLog,
    });

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]); // Callbacks are memoized with useCallback

  // Fetch progress stats on component mount
  useEffect(() => {
    routeEditor.fetchProgress();
  }, []);

  // Update layer filter when showSpecialLines changes
  useEffect(() => {
    if (!map.current || !map.current.getLayer('railway_routes')) return;

    const filter: FilterSpecification | null = routeEditor.showSpecialLines
      ? null // Show all routes
      : ['!=', ['get', 'usage_type'], 1]; // Hide special routes (usage_type === 1)

    map.current.setFilter('railway_routes', filter);
  }, [map, routeEditor.showSpecialLines]);

  // Highlight selected routes from multi-route logger
  useEffect(() => {
    if (!map.current || !map.current.getLayer('railway_routes')) return;

    if (highlightedRoutes.length > 0) {
      // Add a highlight layer for the selected routes
      if (!map.current.getLayer('highlighted_routes')) {
        map.current.addLayer({
          id: 'highlighted_routes',
          type: 'line',
          source: 'railway_routes',
          'source-layer': 'railway_routes', // Required for vector tile sources
          paint: {
            'line-color': '#FFD700', // Gold color for highlight
            'line-width': 6,
            'line-opacity': 0.8,
          },
          filter: ['in', ['get', 'track_id'], ['literal', highlightedRoutes]],
        });
      } else {
        map.current.setFilter('highlighted_routes', [
          'in',
          ['get', 'track_id'],
          ['literal', highlightedRoutes],
        ]);
      }
    } else {
      // Remove highlight layer when no routes are highlighted
      if (map.current.getLayer('highlighted_routes')) {
        map.current.removeLayer('highlighted_routes');
      }
    }
  }, [map, highlightedRoutes]);

  // Handle station selection from search
  const handleStationSelect = (station: Station) => {
    if (!map.current) return;

    const [lon, lat] = station.coordinates;

    // Fly to the station
    map.current.flyTo({
      center: [lon, lat],
      zoom: 14,
      duration: 1500
    });

    // Clear search
    stationSearch.setSearchQuery('');
    stationSearch.setShowSuggestions(false);
    stationSearch.setSelectedStationIndex(-1);
  };

  // Handle keyboard navigation in search
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!stationSearch.showSuggestions || stationSearch.searchResults.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        stationSearch.setSelectedStationIndex(prev =>
          prev < stationSearch.searchResults.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        stationSearch.setSelectedStationIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (stationSearch.selectedStationIndex >= 0 && stationSearch.selectedStationIndex < stationSearch.searchResults.length) {
          handleStationSelect(stationSearch.searchResults[stationSearch.selectedStationIndex]);
        }
        break;
      case 'Escape':
        stationSearch.setShowSuggestions(false);
        stationSearch.setSelectedStationIndex(-1);
        break;
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
      {routeEditor.progress && (
        <div className="absolute top-4 left-4 bg-white p-3 rounded shadow-lg text-black z-10">
          <h3 className="font-bold mb-2 text-sm">Completed</h3>
          <div className="text-lg font-semibold">
            {routeEditor.progress.completedKm}/{routeEditor.progress.totalKm} km
          </div>
          <div className="text-2xl font-bold text-green-600">
            {routeEditor.progress.percentage}%
          </div>
          <div className="text-xs text-gray-600 mt-1">
            {routeEditor.progress.completedRoutes}/{routeEditor.progress.totalRoutes} ({routeEditor.progress.routePercentage}%) routes
          </div>
          <div className="mt-2 pt-2 border-t border-gray-200">
            <label className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={routeEditor.showSpecialLines}
                onChange={(e) => routeEditor.setShowSpecialLines(e.target.checked)}
                className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
              />
              <span>Show special lines</span>
            </label>
          </div>
        </div>
      )}

      {/* Multi-Route Logger Toggle Button */}
      <button
        onClick={() => setShowMultiRouteLogger(!showMultiRouteLogger)}
        className={`absolute top-4 right-4 px-4 py-2 rounded shadow-lg text-white font-medium z-10 cursor-pointer ${
          showMultiRouteLogger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {showMultiRouteLogger ? 'Close Logger' : 'Log Journey'}
      </button>

      {/* Station Search Box */}
      <div className="absolute top-16 right-4 w-80 z-10">
        <div className="relative">
          <input
            ref={stationSearch.searchInputRef}
            type="text"
            value={stationSearch.searchQuery}
            onChange={(e) => stationSearch.setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => stationSearch.searchQuery.length >= 2 && stationSearch.setShowSuggestions(true)}
            onBlur={() => setTimeout(() => stationSearch.setShowSuggestions(false), 200)}
            placeholder="Search stations..."
            className="w-full px-4 py-2 pr-10 bg-white border border-gray-300 rounded-lg shadow-lg text-black text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <svg
            className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>

          {/* Search Suggestions Dropdown */}
          {stationSearch.showSuggestions && !stationSearch.isSearching && stationSearch.searchResults.length > 0 && (
            <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-80 overflow-y-auto z-20">
              {stationSearch.searchResults.map((station, index) => (
                <button
                  key={station.id}
                  onClick={() => handleStationSelect(station)}
                  onMouseEnter={() => stationSearch.setSelectedStationIndex(index)}
                  className={`w-full px-4 py-2 text-left text-sm text-black hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0 ${stationSearch.selectedStationIndex === index ? 'bg-blue-50' : ''
                    }`}
                >
                  <div className="font-medium">{station.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {station.coordinates[1].toFixed(4)}, {station.coordinates[0].toFixed(4)}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Loading indicator */}
          {stationSearch.isSearching && (
            <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl p-3 z-20">
              <div className="flex items-center justify-center text-sm text-gray-500">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
                Searching...
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Multi-Route Logger Panel */}
      {showMultiRouteLogger && (
        <MultiRouteLogger
          onHighlightRoutes={setHighlightedRoutes}
          onClose={() => {
            setShowMultiRouteLogger(false);
            setHighlightedRoutes([]);
          }}
          onRefreshMap={routeEditor.refreshAfterQuickLog}
        />
      )}

      {/* Manage Trips Modal */}
      {routeEditor.showEditForm && routeEditor.editingFeature && (
        <div className="absolute inset-0 flex items-center justify-center z-[9999] text-black">
          <div className="bg-white p-6 rounded-lg shadow-xl border max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">
              Manage Trips: {routeEditor.editingFeature.track_number}
              {' '}
              {routeEditor.editingFeature.from_station} ⟷ {routeEditor.editingFeature.to_station}
            </h3>

            {/* Trips Table */}
            <div className="mb-4 overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Note</th>
                    <th className="text-center p-2">Partial</th>
                    <th className="text-center p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {routeEditor.trips.map((trip) => (
                    <TripRow
                      key={trip.id}
                      trip={trip}
                      onUpdate={routeEditor.updateTrip}
                      onDelete={routeEditor.deleteTrip}
                      onAdd={routeEditor.addTripInline}
                    />
                  ))}
                  {/* Add new trip row */}
                  <TripRow
                    trip={null}
                    onUpdate={routeEditor.updateTrip}
                    onDelete={routeEditor.deleteTrip}
                    onAdd={routeEditor.addTripInline}
                    isNewRow={true}
                  />
                </tbody>
              </table>
            </div>

            {/* Close Button */}
            <div className="flex justify-end">
              <button
                onClick={routeEditor.closeEditForm}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
