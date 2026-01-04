'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { FilterSpecification } from 'maplibre-gl';
import type { Station, SelectedRoute } from '@/lib/types';
import { useMapLibre } from '@/lib/map/hooks/useMapLibre';
import { useStationSearch } from '@/lib/map/hooks/useStationSearch';
import { useRouteEditor } from '@/lib/map/hooks/useRouteEditor';
import {
  createRailwayRoutesSource,
  createRailwayRoutesLayer,
  createScenicRoutesOutlineLayer,
  createStationsSource,
  createStationsLayer,
} from '@/lib/map';
import { setupUserMapInteractions } from '@/lib/map/interactions/userMapInteractions';
import { getUserRouteColorExpression, getUserRouteWidthExpression } from '@/lib/map/utils/userRouteStyling';
import { updateUserPreferences } from '@/lib/userPreferencesActions';
import UserSidebar, { type ActiveTab } from './UserSidebar';
import TripRow from './TripRow';

interface VectorRailwayMapProps {
  className?: string;
  userId: number;
  initialSelectedCountries: string[];
}

export default function VectorRailwayMap({ className = '', userId, initialSelectedCountries }: VectorRailwayMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);

  // Country filter state - initialize with server-provided preferences
  const [selectedCountries, setSelectedCountries] = useState<string[]>(initialSelectedCountries);
  const [cacheBuster, setCacheBuster] = useState<number>(Date.now());

  // Active tab state (tracks which sidebar tab is active)
  const [activeTab, setActiveTab] = useState<ActiveTab>('routes');

  // Station click handler from Journey Planner
  const [journeyStationClickHandler, setJourneyStationClickHandler] = useState<((station: Station | null) => void) | null>(null);

  // Wrapper for setting station click handler
  const handleSetStationClickHandler = useCallback((handler: ((station: Station | null) => void) | null) => {
    // When setting a function in state, need to wrap in another function
    setJourneyStationClickHandler(() => handler ? handler : null);
  }, []);

  // Highlighted routes state (for journey planner)
  const [highlightedRoutes, setHighlightedRoutes] = useState<number[]>([]);

  // Selected routes state
  const [selectedRoutes, setSelectedRoutes] = useState<SelectedRoute[]>([]);

  // Station search hook
  const stationSearch = useStationSearch();

  // Initialize map with shared hook
  const { map } = useMapLibre(
    mapContainer,
    {
      sources: {
        railway_routes: createRailwayRoutesSource({ userId, cacheBuster, selectedCountries }),
        stations: createStationsSource(),
      },
      layers: [
        createScenicRoutesOutlineLayer({
          widthExpression: getUserRouteWidthExpression(),
          filter: ['!=', ['get', 'usage_type'], 1], // Hide special routes by default (matches showSpecialLines initial state)
        }),
        createRailwayRoutesLayer({
          colorExpression: getUserRouteColorExpression(),
          widthExpression: getUserRouteWidthExpression(),
          filter: ['!=', ['get', 'usage_type'], 1], // Hide special routes by default (matches showSpecialLines initial state)
        }),
        createStationsLayer(),
      ],
    },
    [userId, cacheBuster, selectedCountries]
  );

  // Route editor hook (needs map ref and selected countries)
  const routeEditor = useRouteEditor(userId, map, selectedCountries);

  // Handler to toggle route selection (only works in Route Logger tab)
  const handleRouteClick = (route: SelectedRoute) => {
    // Only allow route clicking when in Route Logger tab
    if (activeTab !== 'routes') return;

    // Check if route is already selected
    const isAlreadySelected = selectedRoutes.some(r => r.track_id === route.track_id);
    if (isAlreadySelected) {
      // Remove from selection
      setSelectedRoutes(selectedRoutes.filter(r => r.track_id !== route.track_id));
    } else {
      // Add to selection
      setSelectedRoutes([...selectedRoutes, route]);
    }
  };

  // Handler to remove route from selection
  const handleRemoveRoute = (trackId: string) => {
    setSelectedRoutes(selectedRoutes.filter(r => r.track_id !== trackId));
  };

  // Handler to clear all selected routes
  const handleClearAll = () => {
    setSelectedRoutes([]);
  };

  // Handler to update partial status for a route
  const handleUpdateRoutePartial = (trackId: string, partial: boolean) => {
    setSelectedRoutes(routes =>
      routes.map(r => r.track_id === trackId ? { ...r, partial } : r)
    );
  };

  // Handler to add routes from multi-route logger
  const handleAddRoutesFromLogger = (routes: Array<{track_id: number; from_station: string; to_station: string; description: string; length_km: number}>) => {
    // Convert RouteNode to SelectedRoute format
    const newRoutes = routes.map(route => ({
      track_id: route.track_id.toString(),
      from_station: route.from_station,
      to_station: route.to_station,
      track_number: null, // Not available from pathfinding
      description: route.description || '',
      usage_types: '',
      link: null,
      date: null,
      note: null,
      partial: null,
      length_km: route.length_km
    }));

    // Filter out routes already in selection
    const routesToAdd = newRoutes.filter(
      newRoute => !selectedRoutes.some(existingRoute => existingRoute.track_id === newRoute.track_id)
    );

    setSelectedRoutes([...selectedRoutes, ...routesToAdd]);
  };

  // Setup map interactions after map loads
  useEffect(() => {
    if (!map.current) return;

    const cleanup = setupUserMapInteractions(map.current, {
      onRouteClick: handleRouteClick,
      // Only enable station clicking when in Journey tab and handler is registered
      onStationClick: activeTab === 'journey' && journeyStationClickHandler
        ? journeyStationClickHandler
        : undefined,
    });

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, selectedRoutes, activeTab, journeyStationClickHandler]); // Re-run when activeTab or handler changes

  // Fetch progress stats on component mount
  useEffect(() => {
    routeEditor.fetchProgress();
  }, []);

  // Refresh progress when selected countries change
  useEffect(() => {
    routeEditor.fetchProgress();
  }, [selectedCountries]);

  // Handler for country filter changes
  const handleCountriesChange = async (countries: string[]) => {
    try {
      // Update local state immediately
      setSelectedCountries(countries);

      // Save to database
      await updateUserPreferences(countries);

      // Force map refresh by updating cache buster
      setCacheBuster(Date.now());
    } catch (error) {
      console.error('Error updating country preferences:', error);
    }
  };

  // Update layer filter when showSpecialLines changes
  useEffect(() => {
    if (!map.current || !map.current.getLayer('railway_routes')) return;

    const filter: FilterSpecification | null = routeEditor.showSpecialLines
      ? null // Show all routes
      : ['!=', ['get', 'usage_type'], 1]; // Hide special routes (usage_type === 1)

    // Apply filter to main routes layer
    map.current.setFilter('railway_routes', filter);

    // For scenic outline layer, combine scenic check with special lines filter
    if (map.current.getLayer('railway_routes_scenic_outline')) {
      const scenicFilter: FilterSpecification = routeEditor.showSpecialLines
        ? ['==', ['get', 'scenic'], true] // Show all scenic routes
        : ['all', ['==', ['get', 'scenic'], true], ['!=', ['get', 'usage_type'], 1]]; // Show scenic routes that are not special
      map.current.setFilter('railway_routes_scenic_outline', scenicFilter);
    }
  }, [map, routeEditor.showSpecialLines]);

  // Highlight routes from multi-route logger (gold)
  useEffect(() => {
    if (!map.current || !map.current.getLayer('railway_routes')) return;

    if (highlightedRoutes.length > 0) {
      // Add a highlight layer for the multi-route logger routes
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

  // Highlight selected routes (green if logged, red if not)
  useEffect(() => {
    if (!map.current || !map.current.getLayer('railway_routes')) return;

    const selectedTrackIds = selectedRoutes.map(r => parseInt(r.track_id));

    if (selectedTrackIds.length > 0) {
      // Add a highlight layer for the selected routes
      if (!map.current.getLayer('selected_routes_highlight')) {
        map.current.addLayer({
          id: 'selected_routes_highlight',
          type: 'line',
          source: 'railway_routes',
          'source-layer': 'railway_routes', // Required for vector tile sources
          paint: {
            'line-color': [
              'case',
              ['has', 'date'], // If route has a date (logged)
              '#059669', // Green for logged routes (Tailwind green-600)
              '#DC2626'  // Red for unlogged routes (Tailwind red-600)
            ],
            'line-width': 7,
            'line-opacity': 0.9,
          },
          filter: ['in', ['get', 'track_id'], ['literal', selectedTrackIds]],
        }, 'railway_routes'); // Insert before railway_routes layer so it's underneath
      } else {
        map.current.setFilter('selected_routes_highlight', [
          'in',
          ['get', 'track_id'],
          ['literal', selectedTrackIds],
        ]);
      }
    } else {
      // Remove highlight layer when no routes are selected
      if (map.current.getLayer('selected_routes_highlight')) {
        map.current.removeLayer('selected_routes_highlight');
      }
    }
  }, [map, selectedRoutes]);

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
    <div className="h-full flex relative">
      {/* User Sidebar */}
      <UserSidebar
        selectedRoutes={selectedRoutes}
        onRemoveRoute={handleRemoveRoute}
        onManageTrips={routeEditor.openEditForm}
        onClearAll={handleClearAll}
        onRefreshMap={routeEditor.refreshAfterQuickLog}
        onUpdateRoutePartial={handleUpdateRoutePartial}
        onHighlightRoutes={setHighlightedRoutes}
        onAddRoutesFromPlanner={handleAddRoutesFromLogger}
        selectedCountries={selectedCountries}
        onCountryChange={handleCountriesChange}
        onActiveTabChange={setActiveTab}
        onStationClickHandler={handleSetStationClickHandler}
        sidebarWidth={600}
      />

      {/* Map Container */}
      <div className="flex-1 overflow-hidden relative">
        <div
          ref={mapContainer}
          className={`w-full h-full ${className}`}
          style={{ height: '100%', minHeight: '400px' }}
        />

      {/* Progress Stats Box */}
      {routeEditor.progress && (
        <div className="absolute bottom-10 right-4 bg-white p-3 rounded shadow-lg text-black z-10">
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
      <div className="absolute top-4 right-12 w-80 z-10">
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
      </div>

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
