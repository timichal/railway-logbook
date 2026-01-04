'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { FilterSpecification } from 'maplibre-gl';
import type { User } from '@/lib/authActions';
import type { Station, SelectedRoute } from '@/lib/types';
import { createDataAccess } from '@/lib/dataAccess';
import { LocalStorageManager } from '@/lib/localStorage';
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
import { useToast } from '@/lib/toast';
import UserSidebar, { type ActiveTab } from './UserSidebar';
import TripRow from './TripRow';

interface VectorRailwayMapProps {
  className?: string;
  user: User | null;
  initialSelectedCountries: string[];
}

export default function VectorRailwayMap({ className = '', user, initialSelectedCountries }: VectorRailwayMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const { showError } = useToast();

  // Extract userId for tiles (or null for unlogged users)
  const userId = user?.id || null;

  // Create data access layer based on auth state
  const dataAccess = useMemo(() => createDataAccess(user), [user]);

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

  // Initialize map with shared hook (don't include cacheBuster in deps to avoid full rebuild)
  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      sources: {
        railway_routes: createRailwayRoutesSource({
          userId: userId || undefined,
          selectedCountries
        }),
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
    [userId, selectedCountries]
  );

  // Track which routes have feature states applied (for cleanup)
  const featureStateTrackIdsRef = useRef<Set<number>>(new Set());

  // Update map feature states for localStorage trips (unlogged users only)
  const updateLocalStorageFeatureStates = useCallback(async () => {
    if (!map.current || user) return;

    // Get all localStorage trips
    const allTrips = LocalStorageManager.getTrips();
    console.log('Updating feature states for localStorage trips:', allTrips.length, 'trips');

    // Group trips by track_id and find most recent for each route
    const tripsByRoute = new Map<string, {date: string | null; partial: boolean}>();

    for (const trip of allTrips) {
      const trackId = trip.track_id;
      const existing = tripsByRoute.get(trackId);

      if (!existing || (trip.date && (!existing.date || trip.date > existing.date))) {
        tripsByRoute.set(trackId, {
          date: trip.date,
          partial: trip.partial
        });
      }
    }

    console.log('Applying feature states for', tripsByRoute.size, 'routes');

    // Track new set of track_ids with trips
    const newTrackIds = new Set<number>();

    // Apply feature states to map
    tripsByRoute.forEach((tripData, trackId) => {
      if (!map.current) return;
      const featureId = parseInt(trackId);
      newTrackIds.add(featureId);
      console.log('Setting feature state for track_id', featureId, ':', tripData);
      map.current.setFeatureState(
        { source: 'railway_routes', sourceLayer: 'railway_routes', id: featureId },
        {
          hasTrip: true,
          date: tripData.date,
          partial: tripData.partial
        }
      );
    });

    // Remove feature states for routes that no longer have trips
    featureStateTrackIdsRef.current.forEach(trackId => {
      if (!newTrackIds.has(trackId) && map.current) {
        console.log('Removing feature state for track_id', trackId);
        map.current.removeFeatureState(
          { source: 'railway_routes', sourceLayer: 'railway_routes', id: trackId }
        );
      }
    });

    // Update tracked set
    featureStateTrackIdsRef.current = newTrackIds;
  }, [map, user]);

  // Callback for when route editor refreshes map (used for localStorage feature-state updates)
  const handleMapRefresh = useCallback(() => {
    if (!user && map.current) {
      // For unlogged users, reapply localStorage feature states after tile reload
      updateLocalStorageFeatureStates();
    }
  }, [user, map, updateLocalStorageFeatureStates]);

  // Route editor hook (uses data access layer)
  const routeEditor = useRouteEditor(dataAccess, map, userId, selectedCountries, handleMapRefresh);

  // Handler to toggle route selection (only works in Route Logger tab)
  const handleRouteClick = useCallback(async (route: SelectedRoute) => {
    // Only allow route clicking when in Route Logger tab
    if (activeTab !== 'routes') return;

    // Check if route is already selected using a temporary variable
    let isSelected = false;
    setSelectedRoutes(prev => {
      isSelected = prev.some(r => r.track_id === route.track_id);

      if (isSelected) {
        // Remove from selection
        return prev.filter(r => r.track_id !== route.track_id);
      }

      // Don't add yet, just return unchanged
      return prev;
    });

    // If we just removed it, we're done
    if (isSelected) return;

    // For unlogged users, check trip limit before adding
    if (!user) {
      const canAdd = await dataAccess.canAddMoreTrips();
      if (!canAdd) {
        showError('Trip limit reached (50/50). Please register to log more routes.');
        return;
      }
    }

    // Add to selection
    setSelectedRoutes(prev => [...prev, route]);
  }, [activeTab, user, dataAccess, showError]);

  // Handler to remove route from selection
  const handleRemoveRoute = useCallback((trackId: string) => {
    setSelectedRoutes(prev => prev.filter(r => r.track_id !== trackId));
  }, []);

  // Handler to clear all selected routes
  const handleClearAll = useCallback(() => {
    setSelectedRoutes([]);
  }, []);

  // Handler to update partial status for a route
  const handleUpdateRoutePartial = useCallback((trackId: string, partial: boolean) => {
    setSelectedRoutes(routes =>
      routes.map(r => r.track_id === trackId ? { ...r, partial } : r)
    );
  }, []);

  // Handler to add routes from multi-route logger
  const handleAddRoutesFromLogger = useCallback(async (routes: Array<{track_id: number; from_station: string; to_station: string; description: string; length_km: number}>) => {
    // For unlogged users, check trip limit before adding
    if (!user) {
      const canAdd = await dataAccess.canAddMoreTrips();
      if (!canAdd) {
        showError('Trip limit reached (50/50). Please register to log more routes.');
        return;
      }
    }

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
    setSelectedRoutes(prev => {
      const routesToAdd = newRoutes.filter(
        newRoute => !prev.some(existingRoute => existingRoute.track_id === newRoute.track_id)
      );
      return [...prev, ...routesToAdd];
    });
  }, [user, dataAccess, showError]);

  // Handler called after routes are logged
  const handleRoutesLogged = useCallback(() => {
    if (user) {
      // For logged users: refresh map tiles to show updated route colors from database
      setCacheBuster(Date.now());
    } else {
      // For unlogged users: update feature states based on localStorage
      updateLocalStorageFeatureStates();
    }
    // Refresh progress stats
    routeEditor.fetchProgress();
  }, [user, updateLocalStorageFeatureStates, routeEditor]);

  // Set up localStorage feature states when map loads (for unlogged users)
  useEffect(() => {
    if (!map.current || !mapLoaded || user) return;

    // Wait for tiles to load, then apply feature states
    const applyStates = () => {
      updateLocalStorageFeatureStates();
    };

    if (map.current.isMoving()) {
      map.current.once('idle', applyStates);
    } else {
      applyStates();
    }
  }, [map, mapLoaded, user, updateLocalStorageFeatureStates]);

  // Force map refresh when user changes (login/logout)
  useEffect(() => {
    if (!map.current) return;

    // Update cache buster to force tile reload with new/no user data
    setCacheBuster(Date.now());
  }, [user, map]);

  // Reload railway_routes tiles when cacheBuster changes - used when logged in user logs a route
  useEffect(() => {
    if (!map.current || !mapLoaded || !user) return;

    // Remove existing railway_routes source and layers (including dependent layers)
    const layersToRemove = ['selected_routes_highlight', 'highlighted_routes', 'railway_routes', 'railway_routes_scenic_outline'];
    layersToRemove.forEach(layerId => {
      if (map.current?.getLayer(layerId)) {
        map.current.removeLayer(layerId);
      }
    });

    if (map.current.getSource('railway_routes')) {
      map.current.removeSource('railway_routes');
    }

    // Re-add source with new cache buster
    map.current.addSource('railway_routes', createRailwayRoutesSource({
      userId: userId || undefined,
      cacheBuster,
      selectedCountries
    }));

    // Re-add layers (scenic outline first, then main routes layer on top)
    map.current.addLayer(createScenicRoutesOutlineLayer({
      widthExpression: getUserRouteWidthExpression(),
      filter: ['!=', ['get', 'usage_type'], 1],
    }), 'stations'); // Add before stations layer

    map.current.addLayer(createRailwayRoutesLayer({
      colorExpression: getUserRouteColorExpression(),
      widthExpression: getUserRouteWidthExpression(),
      filter: ['!=', ['get', 'usage_type'], 1],
    }), 'stations'); // Add before stations layer
  }, [cacheBuster]);

  // Setup map interactions after map loads
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    let cleanup: (() => void) | undefined;

    // Wait for tiles to be loaded using 'idle' event
    const setupWhenReady = () => {
      if (!map.current) return;

      // Check if layer exists
      if (!map.current.getLayer('railway_routes')) {
        console.warn('railway_routes layer not found when setting up interactions');
        return;
      }

      console.log('Setting up map interactions');

      cleanup = setupUserMapInteractions(map.current, {
        onRouteClick: handleRouteClick,
        // Only enable station clicking when in Journey tab and handler is registered
        onStationClick: activeTab === 'journey' && journeyStationClickHandler
          ? journeyStationClickHandler
          : undefined,
      });
    };

    // If map is idle (tiles loaded), set up immediately
    if (!map.current.isMoving()) {
      setupWhenReady();
    } else {
      // Otherwise wait for 'idle' event (fires after tiles load)
      map.current.once('idle', setupWhenReady);
    }

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [map, mapLoaded, handleRouteClick, activeTab, journeyStationClickHandler]);

  // Fetch progress stats on component mount and when it changes
  useEffect(() => {
    routeEditor.fetchProgress();
  }, [routeEditor.fetchProgress]);

  // Handler for country filter changes
  const handleCountriesChange = async (countries: string[]) => {
    try {
      // Update local state immediately
      setSelectedCountries(countries);

      // Save preferences (database for logged users, localStorage for unlogged users)
      await dataAccess.updateUserPreferences(countries);

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
          filter: ['in', ['id'], ['literal', highlightedRoutes]],
        });
      } else {
        map.current.setFilter('highlighted_routes', [
          'in',
          ['id'],
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
              // Logged users: Has at least one complete trip (from tile data)
              ['all', ['has', 'date'], ['==', ['get', 'has_complete_trip'], true]],
              '#059669', // Green
              // Logged users: Has trips but no complete trip (from tile data)
              ['has', 'date'],
              '#d97706', // Orange
              // Unlogged users: Has partial trip (from feature-state)
              ['all', ['==', ['feature-state', 'hasTrip'], true], ['==', ['feature-state', 'partial'], true]],
              '#d97706', // Orange
              // Unlogged users: Has complete trip (from feature-state)
              ['==', ['feature-state', 'hasTrip'], true],
              '#059669', // Green
              // No trips
              '#DC2626'  // Red
            ],
            'line-width': 7,
            'line-opacity': 0.9,
          },
          filter: ['in', ['id'], ['literal', selectedTrackIds]],
        }, 'railway_routes'); // Insert before railway_routes layer so it's underneath
      } else {
        map.current.setFilter('selected_routes_highlight', [
          'in',
          ['id'],
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
        user={user}
        dataAccess={dataAccess}
        selectedRoutes={selectedRoutes}
        onRemoveRoute={handleRemoveRoute}
        onManageTrips={routeEditor.openEditForm}
        onClearAll={handleClearAll}
        onUpdateRoutePartial={handleUpdateRoutePartial}
        onHighlightRoutes={setHighlightedRoutes}
        onAddRoutesFromPlanner={handleAddRoutesFromLogger}
        onRoutesLogged={handleRoutesLogged}
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
