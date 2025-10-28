'use client';

import { useEffect, useRef } from 'react';
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

interface VectorRailwayMapProps {
  className?: string;
  userId: number;
}

export default function VectorRailwayMap({ className = '', userId }: VectorRailwayMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);

  // Station search hook
  const stationSearch = useStationSearch();

  // Initialize map with shared hook
  const { map, mapLoaded } = useMapLibre(
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
      onQuickUnlog: routeEditor.quickUnlog,
    });

    return cleanup;
  }, [map, routeEditor.openEditForm, routeEditor.quickLog, routeEditor.quickUnlog]);

  // Fetch progress stats on component mount
  useEffect(() => {
    routeEditor.fetchProgress();
  }, []);

  // Update layer filter when showSpecialLines changes or map loads
  useEffect(() => {
    if (!map.current || !map.current.getLayer('railway_routes')) return;

    const filter: FilterSpecification | null = routeEditor.showSpecialLines
      ? null // Show all routes
      : ['!=', ['get', 'usage_type'], 2]; // Hide special routes (usage_type === 2)

    map.current.setFilter('railway_routes', filter);
  }, [map, mapLoaded, routeEditor.showSpecialLines]);

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

      {/* Station Search Box */}
      <div className="absolute top-4 right-16 w-80 z-10">
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

      {/* Edit Form Modal */}
      {routeEditor.showEditForm && routeEditor.editingFeature && (
        <div className="absolute inset-0 flex items-center justify-center z-[9999] text-black">
          <div className="bg-white p-6 rounded-lg shadow-xl border max-w-md w-full mx-4">
            <h3 className="text-lg font-bold mb-4">
              {routeEditor.editingFeature.track_number}
              {' '}
              {routeEditor.editingFeature.name}
            </h3>

            <form onSubmit={routeEditor.submitForm} className="space-y-4">
              <div>
                <label htmlFor="date" className="block text-sm font-medium mb-1">
                  Date
                </label>
                <div className="relative">
                  <input
                    type="date"
                    id="date"
                    value={routeEditor.date}
                    onChange={(e) => routeEditor.setDate(e.target.value)}
                    className={`w-full pl-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${routeEditor.date ? 'pr-6' : 'pr-3'}`}
                  />
                  {routeEditor.date && (
                    <button
                      type="button"
                      onClick={() => routeEditor.setDate('')}
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
                  value={routeEditor.note}
                  onChange={(e) => routeEditor.setNote(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional note..."
                />
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={routeEditor.partial}
                    onChange={(e) => routeEditor.setPartial(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  />
                  <span className="text-sm font-medium">Partial</span>
                </label>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={routeEditor.closeEditForm}
                  className="px-4 py-2 text-gray-600 bg-gray-200 rounded hover:bg-gray-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={routeEditor.isLoading}
                  className={`px-4 py-2 text-white rounded cursor-pointer flex items-center gap-2 ${routeEditor.isLoading
                      ? 'bg-blue-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                >
                  {routeEditor.isLoading && (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  )}
                  {routeEditor.isLoading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
