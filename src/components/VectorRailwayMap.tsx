'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { User } from '@/lib/authActions';
import type { Station, SelectedRoute } from '@/lib/types';
import { createDataAccess } from '@/lib/dataAccess';
import { LocalStorageManager } from '@/lib/localStorage';
import { useMapLibre } from '@/lib/map/hooks/useMapLibre';
import { useStationSearch } from '@/lib/map/hooks/useStationSearch';
import { useRouteEditor } from '@/lib/map/hooks/useRouteEditor';
import { useMapTileRefresh } from '@/lib/map/hooks/useMapTileRefresh';
import { useRouteHighlighting } from '@/lib/map/hooks/useRouteHighlighting';
import { useLayerFilters } from '@/lib/map/hooks/useLayerFilters';
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

interface VectorRailwayMapProps {
  className?: string;
  user: User | null;
  initialSelectedCountries: string[];
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  sidebarWidth: number;
  onSidebarResize: () => void;
  isResizing: boolean;
  isMobile: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export default function VectorRailwayMap({
  className = '',
  user,
  initialSelectedCountries,
  activeTab,
  setActiveTab,
  sidebarWidth,
  onSidebarResize,
  isResizing,
  isMobile,
  sidebarOpen,
  onToggleSidebar
}: VectorRailwayMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const { showError } = useToast();

  const userId = user?.id || null;
  const dataAccess = useMemo(() => createDataAccess(user), [user]);

  // Country filter state
  const [selectedCountries, setSelectedCountries] = useState<string[]>(initialSelectedCountries);

  // Scenic routes outline toggle
  const [showScenicOutline, setShowScenicOutline] = useState<boolean>(false);

  // Station click handler from Journey Planner
  const [journeyStationClickHandler, setJourneyStationClickHandler] = useState<((station: Station | null) => void) | null>(null);
  const handleSetStationClickHandler = useCallback((handler: ((station: Station | null) => void) | null) => {
    setJourneyStationClickHandler(() => handler ? handler : null);
  }, []);

  // Journey edit mode: route clicks in My Journeys tab go to the edit handler
  const journeyRouteClickHandlerRef = useRef<((route: SelectedRoute) => void) | null>(null);
  const [journeyEditActive, setJourneyEditActive] = useState(false);
  const handleJourneyEditStart = useCallback((handler: (route: SelectedRoute) => void) => {
    journeyRouteClickHandlerRef.current = handler;
    setJourneyEditActive(true);
  }, []);
  const handleJourneyEditEnd = useCallback(() => {
    journeyRouteClickHandlerRef.current = null;
    setJourneyEditActive(false);
  }, []);

  // Highlighted routes state (for journey planner)
  const [highlightedRoutes, setHighlightedRoutes] = useState<number[]>([]);

  // Selected routes state
  const [selectedRoutes, setSelectedRoutes] = useState<SelectedRoute[]>([]);

  const stationSearch = useStationSearch();

  // Shared layer configs
  const defaultFilter: ['!=', ['get', string], number] = ['!=', ['get', 'usage_type'], 1];

  const routeLayerConfig = useMemo(() => ({
    colorExpression: getUserRouteColorExpression(),
    widthExpression: getUserRouteWidthExpression(),
    filter: defaultFilter,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const scenicLayerConfig = useMemo(() => ({
    widthExpression: getUserRouteWidthExpression(),
    filter: defaultFilter,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize map
  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      sources: {
        railway_routes: createRailwayRoutesSource({ userId: userId || undefined, selectedCountries }),
        stations: createStationsSource(),
      },
      layers: [
        createScenicRoutesOutlineLayer(scenicLayerConfig),
        createRailwayRoutesLayer(routeLayerConfig),
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

    const allParts = LocalStorageManager.getLoggedParts();
    const routeStatus = new Map<string, {hasComplete: boolean; hasPartial: boolean}>();

    for (const part of allParts) {
      const trackId = String(part.track_id);
      const existing = routeStatus.get(trackId) || {hasComplete: false, hasPartial: false};
      if (!part.partial) {
        existing.hasComplete = true;
      } else {
        existing.hasPartial = true;
      }
      routeStatus.set(trackId, existing);
    }

    const newTrackIds = new Set<number>();

    routeStatus.forEach((status, trackId) => {
      if (!map.current) return;
      const featureId = parseInt(trackId);
      newTrackIds.add(featureId);
      const isPartial = status.hasPartial && !status.hasComplete;
      map.current.setFeatureState(
        { source: 'railway_routes', sourceLayer: 'railway_routes', id: featureId },
        { hasTrip: true, date: new Date().toISOString().split('T')[0], partial: isPartial }
      );
    });

    featureStateTrackIdsRef.current.forEach(trackId => {
      if (!newTrackIds.has(trackId) && map.current) {
        map.current.removeFeatureState(
          { source: 'railway_routes', sourceLayer: 'railway_routes', id: trackId }
        );
      }
    });

    featureStateTrackIdsRef.current = newTrackIds;
  }, [map, user]);

  // Route editor hook
  const routeEditor = useRouteEditor(dataAccess, map, selectedCountries);

  // Tile refresh hook (for logged-in user route logging)
  const { refreshTiles } = useMapTileRefresh({
    map, mapLoaded,
    userId,
    selectedCountries,
    routeLayerConfig,
    scenicLayerConfig,
  });

  // Route highlighting hooks
  useRouteHighlighting(map, highlightedRoutes, selectedRoutes);

  // Layer filter hooks
  useLayerFilters(map, routeEditor.showSpecialLines, showScenicOutline);

  // Route click handler
  const handleRouteClick = useCallback(async (route: SelectedRoute) => {
    // Journey edit mode: delegate to the journey edit handler
    if (journeyEditActive && journeyRouteClickHandlerRef.current) {
      journeyRouteClickHandlerRef.current(route);
      return;
    }

    if (activeTab !== 'routes') return;

    let isSelected = false;
    setSelectedRoutes(prev => {
      isSelected = prev.some(r => r.track_id === route.track_id);
      if (isSelected) return prev.filter(r => r.track_id !== route.track_id);
      return prev;
    });

    if (isSelected) return;

    if (!user) {
      const canAdd = await dataAccess.canAddMoreJourneys();
      if (!canAdd) {
        showError('Trip limit reached (50/50). Please register to log more routes.');
        return;
      }
    }

    setSelectedRoutes(prev => [...prev, route]);
  }, [activeTab, journeyEditActive, user, dataAccess, showError]);

  const handleRemoveRoute = useCallback((trackId: string) => {
    setSelectedRoutes(prev => prev.filter(r => r.track_id !== trackId));
  }, []);

  const handleClearAll = useCallback(() => {
    setSelectedRoutes([]);
  }, []);

  const handleUpdateRoutePartial = useCallback((trackId: string, partial: boolean) => {
    setSelectedRoutes(routes =>
      routes.map(r => r.track_id === trackId ? { ...r, partial } : r)
    );
  }, []);

  const handleAddRoutesFromLogger = useCallback(async (routes: Array<{track_id: number; from_station: string; to_station: string; description: string; length_km: number}>) => {
    if (!user) {
      const canAdd = await dataAccess.canAddMoreJourneys();
      if (!canAdd) {
        showError('Trip limit reached (50/50). Please register to log more routes.');
        return;
      }
    }

    const newRoutes = routes.map(route => ({
      track_id: route.track_id.toString(),
      from_station: route.from_station,
      to_station: route.to_station,
      track_number: null,
      description: route.description || '',
      usage_types: '',
      link: null,
      date: null,
      journey_name: null,
      partial: null,
      length_km: route.length_km
    }));

    setSelectedRoutes(prev => {
      const routesToAdd = newRoutes.filter(
        newRoute => !prev.some(existingRoute => existingRoute.track_id === newRoute.track_id)
      );
      return [...prev, ...routesToAdd];
    });
  }, [user, dataAccess, showError]);

  const handleRoutesLogged = useCallback(() => {
    if (user) {
      refreshTiles();
      routeEditor.refreshProgress();
    } else {
      updateLocalStorageFeatureStates();
      routeEditor.refreshProgress();
    }
  }, [user, refreshTiles, updateLocalStorageFeatureStates, routeEditor.refreshProgress]);

  // Set up localStorage feature states when map loads (for unlogged users)
  useEffect(() => {
    if (!map.current || !mapLoaded || user) return;

    const applyStates = () => { updateLocalStorageFeatureStates(); };

    if (map.current.isMoving()) {
      map.current.once('idle', applyStates);
    } else {
      applyStates();
    }
  }, [map, mapLoaded, user, updateLocalStorageFeatureStates]);

  // Force map refresh when user changes (login/logout)
  useEffect(() => {
    if (!map.current) return;
    refreshTiles();
  }, [user, map]); // eslint-disable-line react-hooks/exhaustive-deps

  // Setup map interactions
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    let cleanup: (() => void) | undefined;

    const setupWhenReady = () => {
      if (!map.current || !map.current.getLayer('railway_routes')) return;

      cleanup = setupUserMapInteractions(map.current, {
        onRouteClick: handleRouteClick,
        onStationClick: activeTab === 'routes' && journeyStationClickHandler
          ? journeyStationClickHandler
          : undefined,
      });
    };

    if (!map.current.isMoving()) {
      setupWhenReady();
    } else {
      map.current.once('idle', setupWhenReady);
    }

    return () => { if (cleanup) cleanup(); };
  }, [map, mapLoaded, handleRouteClick, activeTab, journeyStationClickHandler]);

  // Fetch progress stats on mount
  useEffect(() => {
    if (mapLoaded) routeEditor.refreshProgress();
  }, [mapLoaded, routeEditor.refreshProgress]);

  // Country filter handler
  const handleCountriesChange = async (countries: string[]) => {
    try {
      setSelectedCountries(countries);
      await dataAccess.updateUserPreferences(countries);
      refreshTiles();
    } catch (error) {
      console.error('Error updating country preferences:', error);
    }
  };

  // Station search handler
  const handleStationSelect = (station: Station) => {
    if (!map.current) return;
    const [lon, lat] = station.coordinates;
    map.current.flyTo({ center: [lon, lat], zoom: 14, duration: 1500 });
    stationSearch.setSearchQuery('');
    stationSearch.setShowSuggestions(false);
    stationSearch.setSelectedStationIndex(-1);
  };

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

  // Resize map when sidebar opens/closes on mobile
  useEffect(() => {
    if (!map.current) return;
    // Small delay to let CSS transitions finish
    const timer = setTimeout(() => {
      map.current?.resize();
    }, 300);
    return () => clearTimeout(timer);
  }, [sidebarOpen, isMobile, map]);

  // Sidebar content (shared between mobile drawer and desktop inline)
  const sidebarContent = (
    <UserSidebar
      user={user}
      dataAccess={dataAccess}
      selectedRoutes={selectedRoutes}
      onRemoveRoute={handleRemoveRoute}
      onClearAll={handleClearAll}
      onUpdateRoutePartial={handleUpdateRoutePartial}
      onHighlightRoutes={setHighlightedRoutes}
      onAddRoutesFromPlanner={handleAddRoutesFromLogger}
      onRoutesLogged={handleRoutesLogged}
      selectedCountries={selectedCountries}
      onCountryChange={handleCountriesChange}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onStationClickHandler={handleSetStationClickHandler}
      sidebarWidth={isMobile ? null : sidebarWidth}
      onJourneyEditStart={handleJourneyEditStart}
      onJourneyEditEnd={handleJourneyEditEnd}
    />
  );

  return (
    <div className="h-full flex relative">
      {/* Desktop sidebar */}
      {!isMobile && (
        <>
          {sidebarContent}
          {/* Resizer */}
          <div
            onMouseDown={onSidebarResize}
            className={`w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize flex-shrink-0 ${isResizing ? 'bg-blue-400' : ''}`}
            style={{ userSelect: 'none' }}
          />
        </>
      )}

      {/* Mobile drawer overlay */}
      {isMobile && sidebarOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 z-30"
            onClick={onToggleSidebar}
          />
          {/* Drawer */}
          <div className="fixed inset-y-0 left-0 z-40 w-full max-w-md bg-white flex flex-col sidebar-drawer-open">
            {/* Drawer close header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 flex-shrink-0">
              <span className="text-sm font-medium text-gray-700">Sidebar</span>
              <button
                onClick={onToggleSidebar}
                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded cursor-pointer"
                aria-label="Close sidebar"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col">
              {sidebarContent}
            </div>
          </div>
        </>
      )}

      {/* Map Container */}
      <div className="flex-1 overflow-hidden relative">
        <div
          ref={mapContainer}
          className={`w-full h-full ${className}`}
          style={{ height: '100%', minHeight: '400px' }}
        />

      {/* Progress Stats Box */}
      {routeEditor.progress && (
        <div className={`absolute bg-white p-3 rounded shadow-lg text-black z-10 ${
          isMobile ? 'bottom-4 left-3 text-xs' : 'bottom-10 right-4'
        }`}>
          <h3 className={`font-bold mb-2 ${isMobile ? 'text-xs' : 'text-sm'}`}>Completed</h3>
          <div className={`font-semibold ${isMobile ? 'text-sm' : 'text-lg'}`}>
            {routeEditor.progress.completedKm}/{routeEditor.progress.totalKm} km
          </div>
          <div className={`font-bold text-green-600 ${isMobile ? 'text-lg' : 'text-2xl'}`}>
            {routeEditor.progress.percentage}%
          </div>
          <div className="text-xs text-gray-600 mt-1">
            {routeEditor.progress.completedRoutes}/{routeEditor.progress.totalRoutes} ({routeEditor.progress.routePercentage}%) routes
          </div>
          <div className="mt-2 pt-2 border-t border-gray-200">
            <label className="flex items-center gap-2 cursor-pointer text-xs mb-2">
              <input
                type="checkbox"
                checked={routeEditor.showSpecialLines}
                onChange={() => routeEditor.toggleShowSpecialLines()}
                className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
              />
              <span>Show special lines</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={showScenicOutline}
                onChange={(e) => setShowScenicOutline(e.target.checked)}
                className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
              />
              <span>Highlight scenic lines</span>
            </label>
          </div>
        </div>
      )}

      {/* Station Search Box */}
      <div className={`absolute z-10 ${
        isMobile ? 'top-3 left-3 right-3' : 'top-4 right-12 w-80'
      }`}>
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
    </div>
  );
}
