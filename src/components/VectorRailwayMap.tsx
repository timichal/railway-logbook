"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@/lib/authActions";
import { createDataAccess } from "@/lib/dataAccess";
import {
  createPublicNotesSource,
  createPublicStationsSource,
  createRailwayRoutesSource,
} from "@/lib/map";
import { useCoverageOverlay } from "@/lib/map/hooks/useCoverageOverlay";
import { useLayerFilters } from "@/lib/map/hooks/useLayerFilters";
import { useMapLibre } from "@/lib/map/hooks/useMapLibre";
import { useMapTileRefresh } from "@/lib/map/hooks/useMapTileRefresh";
import { useRouteEditor } from "@/lib/map/hooks/useRouteEditor";
import { useRouteHighlighting } from "@/lib/map/hooks/useRouteHighlighting";
import { useStationSearch } from "@/lib/map/hooks/useStationSearch";
import { setupUserMapInteractions } from "@/lib/map/interactions/userMapInteractions";
import { useLayerPrefs } from "@/lib/map/layerPrefsContext";
import {
  createUserMapLayers,
  userClickBufferLayerConfig,
  userHeritageLayerConfig,
  userRouteLayerConfig,
  userScenicLayerConfig,
  userSpecialLayerConfig,
} from "@/lib/map/userMapLayers";
import { useRegion } from "@/lib/regionContext";
import { regionCountryCodes } from "@/lib/regions";
import { useToast } from "@/lib/toast";
import type {
  HighlightKind,
  HighlightRoutesFn,
  PartialRouteGeometry,
  PlannerRoute,
  SelectedRoute,
  Station,
} from "@/lib/types";
import { optionRow } from "@/lib/ui/buttonStyles";
import MapProgressBox from "./MapProgressBox";
import MobileBottomSheet from "./MobileBottomSheet";
import UserSidebar, { type ActiveTab } from "./UserSidebar";

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
}

export default function VectorRailwayMap({
  className = "",
  user,
  initialSelectedCountries,
  activeTab,
  setActiveTab,
  sidebarWidth,
  onSidebarResize,
  isResizing,
  isMobile,
}: VectorRailwayMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const { showError } = useToast();

  const userId = user?.id || null;
  const region = useRegion();
  const layerPrefs = useLayerPrefs();
  const dataAccess = useMemo(() => createDataAccess(user, region.id), [user, region.id]);

  // Country filter state
  const [selectedCountries, setSelectedCountries] = useState<string[]>(initialSelectedCountries);

  // The country list everything on the map actually filters by. A region the
  // user can't filter by country (Japan, one country) pins it to its own list,
  // which is what keeps the other region's routes, stats and ridden stretches
  // out of this view - the country filter was already doing that job for the
  // European countries, and the regions just happen to be disjoint sets of it.
  const effectiveCountries = useMemo(
    () => (region.hasCountryFilter ? selectedCountries : regionCountryCodes(region.id)),
    [region, selectedCountries],
  );

  // Scenic routes outline toggle

  // Station click handler from Journey Planner
  const [journeyStationClickHandler, setJourneyStationClickHandler] = useState<
    ((station: Station | null) => void) | null
  >(null);
  const handleSetStationClickHandler = useCallback(
    (handler: ((station: Station | null) => void) | null) => {
      setJourneyStationClickHandler(() => (handler ? handler : null));
    },
    [],
  );

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

  // Highlighted routes state. `kind` controls the highlight color: 'planner'
  // (gold) for pathfinder results, 'view' (orange) for My Trips browsing.
  // `partialHighlights` carries the covered stretch of any route the highlight
  // should only cover part of (Journey Planner joining a route mid-way).
  const [highlightedRoutes, setHighlightedRoutes] = useState<number[]>([]);
  const [highlightKind, setHighlightKind] = useState<HighlightKind>("view");
  const [partialHighlights, setPartialHighlights] = useState<PartialRouteGeometry[]>([]);
  // Bumped whenever journeys change, to refetch the ridden-stretch overlay
  const [coverageVersion, setCoverageVersion] = useState(0);
  const handleHighlightRoutes = useCallback<HighlightRoutesFn>(
    (ids, kind = "view", partials = []) => {
      setHighlightedRoutes(ids);
      setHighlightKind(kind);
      setPartialHighlights(partials);
    },
    [],
  );

  // Selected routes state
  const [selectedRoutes, setSelectedRoutes] = useState<SelectedRoute[]>([]);
  const selectedRoutesRef = useRef<SelectedRoute[]>([]);
  selectedRoutesRef.current = selectedRoutes;

  const stationSearch = useStationSearch(region.id);

  // Initialize map
  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      region: region.id,
      sources: {
        railway_routes: createRailwayRoutesSource({
          userId: userId || undefined,
          selectedCountries: effectiveCountries,
        }),
        stations: createPublicStationsSource(),
        public_notes: createPublicNotesSource(),
      },
      layers: createUserMapLayers(),
    },
    [userId, effectiveCountries, region.id],
  );

  // Track which routes have feature states applied (for cleanup)
  const featureStateTrackIdsRef = useRef<Set<number>>(new Set());

  // Update map feature states for localStorage trips (unlogged users only).
  // The tiles carry no visit status for an unauthenticated visitor, so which
  // routes read as ridden whole is worked out from the local log (see
  // getLocalRouteStatuses) and applied per feature.
  const updateLocalStorageFeatureStates = useCallback(async () => {
    if (!map.current || user) return;

    const statuses = await dataAccess.getLocalRouteStatuses();
    // Re-read after the await: the map may have gone away while it ran
    const target = map.current;
    if (!target) return;

    const newTrackIds = new Set<number>();
    for (const status of statuses) {
      newTrackIds.add(status.track_id);
      target.setFeatureState(
        { source: "railway_routes", sourceLayer: "railway_routes", id: status.track_id },
        {
          hasTrip: true,
          date: new Date().toISOString().split("T")[0],
          partial: !status.complete,
        },
      );
    }

    featureStateTrackIdsRef.current.forEach((trackId) => {
      if (!newTrackIds.has(trackId)) {
        target.removeFeatureState({
          source: "railway_routes",
          sourceLayer: "railway_routes",
          id: trackId,
        });
      }
    });

    featureStateTrackIdsRef.current = newTrackIds;
  }, [map, user, dataAccess]);

  // Route editor hook
  const routeEditor = useRouteEditor(dataAccess, effectiveCountries);

  // Tile refresh hook (for logged-in user route logging)
  const { refreshTiles, cacheBuster } = useMapTileRefresh({
    map,
    mapLoaded,
    userId,
    selectedCountries: effectiveCountries,
    routeLayerConfig: userRouteLayerConfig,
    scenicLayerConfig: userScenicLayerConfig,
    clickBufferLayerConfig: userClickBufferLayerConfig,
    specialLayerConfig: userSpecialLayerConfig,
    heritageLayerConfig: userHeritageLayerConfig,
  });

  // Route highlighting hooks (cacheBuster forces re-run after tile refresh drops the layer)
  useRouteHighlighting(
    map,
    highlightedRoutes,
    highlightKind,
    selectedRoutes,
    cacheBuster,
    partialHighlights,
  );

  // Ridden stretches of routes not yet finished, drawn over the route line
  useCoverageOverlay(map, mapLoaded, dataAccess, effectiveCountries, coverageVersion, cacheBuster);

  // Layer filter hooks. mapLoaded applies persisted prefs once layers exist;
  // cacheBuster re-applies filters after a tile refresh re-adds layers.
  useLayerFilters(
    map,
    layerPrefs.showHeritage,
    layerPrefs.showSpecial,
    // The stored preference is shared across regions; one that offers no scenic
    // outline keeps it off regardless of what the other region left switched on.
    layerPrefs.showScenicOutline && region.hasScenicHighlight,
    mapLoaded,
    cacheBuster,
  );

  // Route click handler
  const handleRouteClick = useCallback(
    async (route: SelectedRoute) => {
      // Journey edit mode: delegate to the journey edit handler
      if (journeyEditActive && journeyRouteClickHandlerRef.current) {
        journeyRouteClickHandlerRef.current(route);
        return;
      }

      if (activeTab !== "routes") return;

      // Toggle: if already selected, remove it
      const isSelected = selectedRoutesRef.current.some((r) => r.track_id === route.track_id);
      if (isSelected) {
        setSelectedRoutes((prev) => prev.filter((r) => r.track_id !== route.track_id));
        return;
      }

      if (!user) {
        const canAdd = await dataAccess.canAddMoreJourneys();
        if (!canAdd) {
          showError("Trip limit reached (50/50). Please register to log more routes.");
          return;
        }
      }

      setSelectedRoutes((prev) => [...prev, route]);
    },
    [activeTab, journeyEditActive, user, dataAccess, showError],
  );

  // Switching regions drops everything picked out of the old one: a selection
  // logged after the switch would file the other continent's routes under this
  // journey, and a highlight would point at track the map can no longer show.
  // biome-ignore lint/correctness/useExhaustiveDependencies: region.id is the trigger; the setters are stable and intentionally not read here.
  useEffect(() => {
    setSelectedRoutes([]);
    setHighlightedRoutes([]);
    setPartialHighlights([]);
  }, [region.id]);

  const handleRemoveRoute = useCallback((trackId: number) => {
    setSelectedRoutes((prev) => prev.filter((r) => r.track_id !== trackId));
  }, []);

  const handleClearAll = useCallback(() => {
    setSelectedRoutes([]);
  }, []);

  const handleUpdateRoutePartial = useCallback((trackId: number, partial: boolean) => {
    setSelectedRoutes((routes) =>
      routes.map((r) => (r.track_id === trackId ? { ...r, partial } : r)),
    );
  }, []);

  const handleAddRoutesFromLogger = useCallback(
    async (routes: PlannerRoute[]) => {
      if (!user) {
        const canAdd = await dataAccess.canAddMoreJourneys();
        if (!canAdd) {
          showError("Trip limit reached (50/50). Please register to log more routes.");
          return;
        }
      }

      const newRoutes = routes.map((route) => ({
        track_id: route.track_id,
        from_station: route.from_station,
        to_station: route.to_station,
        description: route.description || "",
        usage_types: "",
        link: null,
        date: null,
        journey_name: null,
        // A plan that joins this route mid-way only covers part of it, so the
        // route arrives in the selection with "partial" already ticked and the
        // ridden stretch attached, ready to be stored with the journey
        partial: route.partial ? true : null,
        covered: route.partial ?? null,
        length_km: route.length_km,
      }));

      setSelectedRoutes((prev) => {
        const routesToAdd = newRoutes.filter(
          (newRoute) => !prev.some((existingRoute) => existingRoute.track_id === newRoute.track_id),
        );
        return [...prev, ...routesToAdd];
      });
    },
    [user, dataAccess, showError],
  );

  const handleRoutesLogged = useCallback(() => {
    if (user) {
      refreshTiles();
      routeEditor.refreshProgress();
    } else {
      updateLocalStorageFeatureStates();
      routeEditor.refreshProgress();
    }
    // Journeys changed, so the ridden stretches of unfinished routes may have too
    setCoverageVersion((v) => v + 1);
  }, [user, refreshTiles, updateLocalStorageFeatureStates, routeEditor.refreshProgress]);

  // Set up localStorage feature states when map loads (for unlogged users)
  useEffect(() => {
    if (!map.current || !mapLoaded || user) return;

    const applyStates = () => {
      updateLocalStorageFeatureStates();
    };

    if (map.current.isMoving()) {
      map.current.once("idle", applyStates);
    } else {
      applyStates();
    }
  }, [map, mapLoaded, user, updateLocalStorageFeatureStates]);

  // Force map refresh when user changes (login/logout)
  // biome-ignore lint/correctness/useExhaustiveDependencies: user is the intentional trigger (login/logout); refreshTiles is a stable callback we don't want to re-trigger on.
  useEffect(() => {
    if (!map.current) return;
    refreshTiles();
  }, [user, map]);

  // Setup map interactions
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    let cleanup: (() => void) | undefined;

    const setupWhenReady = () => {
      if (!map.current?.getLayer("railway_routes")) return;

      cleanup = setupUserMapInteractions(map.current, {
        onRouteClick: handleRouteClick,
        onStationClick:
          activeTab === "routes" && journeyStationClickHandler
            ? journeyStationClickHandler
            : undefined,
        region: region.id,
      });
    };

    if (!map.current.isMoving()) {
      setupWhenReady();
    } else {
      map.current.once("idle", setupWhenReady);
    }

    return () => {
      if (cleanup) cleanup();
    };
  }, [map, mapLoaded, handleRouteClick, activeTab, journeyStationClickHandler, region.id]);

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
      console.error("Error updating country preferences:", error);
    }
  };

  // Station search handler
  const handleStationSelect = (station: Station) => {
    if (!map.current) return;
    const [lon, lat] = station.coordinates;
    map.current.flyTo({ center: [lon, lat], zoom: 14, duration: 1500 });
    stationSearch.setSearchQuery("");
    stationSearch.setShowSuggestions(false);
    stationSearch.setSelectedStationIndex(-1);
    // The dropdown holds focus in the input (see the suggestion list below), so the
    // field has to be released here or the keyboard stays up over the map.
    stationSearch.searchInputRef.current?.blur();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!stationSearch.showSuggestions || stationSearch.searchResults.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        stationSearch.setSelectedStationIndex((prev) =>
          prev < stationSearch.searchResults.length - 1 ? prev + 1 : prev,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        stationSearch.setSelectedStationIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (
          stationSearch.selectedStationIndex >= 0 &&
          stationSearch.selectedStationIndex < stationSearch.searchResults.length
        ) {
          handleStationSelect(stationSearch.searchResults[stationSearch.selectedStationIndex]);
        }
        break;
      case "Escape":
        stationSearch.setShowSuggestions(false);
        stationSearch.setSelectedStationIndex(-1);
        break;
    }
  };

  // The mobile sheet settles at a new height -> the map has more or less room.
  const handleSheetHeightSettled = useCallback(() => {
    map.current?.resize();
  }, [map]);

  // Resize map when the layout switches between the desktop sidebar and the mobile
  // sheet. Height changes *within* the sheet come through handleSheetHeightSettled.
  // biome-ignore lint/correctness/useExhaustiveDependencies: isMobile is an intentional trigger — the effect resizes the map when it changes, even though it is not read in the body.
  useEffect(() => {
    if (!map.current) return;
    // Small delay to let CSS transitions finish
    const timer = setTimeout(() => {
      map.current?.resize();
    }, 300);
    return () => clearTimeout(timer);
  }, [isMobile, map]);

  // Sidebar content (shared between mobile drawer and desktop inline)
  const sidebarContent = (
    <UserSidebar
      user={user}
      dataAccess={dataAccess}
      selectedRoutes={selectedRoutes}
      onRemoveRoute={handleRemoveRoute}
      onClearAll={handleClearAll}
      onUpdateRoutePartial={handleUpdateRoutePartial}
      onHighlightRoutes={handleHighlightRoutes}
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
    <div className={`h-full relative ${isMobile ? "flex flex-col" : "flex"}`}>
      {/* Desktop sidebar */}
      {!isMobile && (
        <>
          {sidebarContent}
          {/* Resizer: mouse-only drag handle (keyboard resize intentionally unsupported) */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: mouse-only resize affordance with no keyboard equivalent; the sidebar remains fully usable without resizing. */}
          <div
            onMouseDown={onSidebarResize}
            className={`w-1 bg-gray-200 hover:bg-blue-400 cursor-col-resize flex-shrink-0 ${isResizing ? "bg-blue-400" : ""}`}
            style={{ userSelect: "none" }}
          />
        </>
      )}

      {/* Map Container */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div
          ref={mapContainer}
          className={`w-full h-full ${className}`}
          // No min-height on mobile: the sheet can take 90% of the column, and a
          // floor taller than what is left would leave the canvas clipped and
          // off-centre behind the sheet.
          style={{ height: "100%", minHeight: isMobile ? undefined : "400px" }}
        />

        {/* Progress Stats Box */}
        {routeEditor.progress && (
          <MapProgressBox
            progress={routeEditor.progress}
            isMobile={isMobile}
            // Mobile keeps them in the menu instead — see MobileMenuSheet.
            withLayerToggles={!isMobile}
          />
        )}

        {/* Station Search Box */}
        <div
          className={`absolute z-10 ${isMobile ? "top-3 left-3 right-14" : "top-4 right-12 w-80"}`}
        >
          <div className="relative">
            <input
              ref={stationSearch.searchInputRef}
              type="text"
              value={stationSearch.searchQuery}
              onChange={(e) => stationSearch.setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onFocus={() =>
                stationSearch.searchQuery.length >= 2 && stationSearch.setShowSuggestions(true)
              }
              onBlur={() => setTimeout(() => stationSearch.setShowSuggestions(false), 200)}
              placeholder="Search stations..."
              className="w-full px-4 py-2 pr-10 bg-white border border-gray-300 rounded-lg shadow-lg text-black text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <svg
              className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>

            {/* Search Suggestions Dropdown */}
            {stationSearch.showSuggestions &&
              !stationSearch.isSearching &&
              stationSearch.searchResults.length > 0 && (
                <div
                  // Keeps the focus in the input: without it the pointerdown blurs
                  // the field and the 200ms blur timer above hides the list before
                  // the click lands — on touch, even scrolling the list did it.
                  onPointerDown={(e) => e.preventDefault()}
                  className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-80 overflow-y-auto z-20"
                >
                  {stationSearch.searchResults.map((station, index) => (
                    <button
                      type="button"
                      key={station.id}
                      onClick={() => handleStationSelect(station)}
                      onMouseEnter={() => stationSearch.setSelectedStationIndex(index)}
                      className={`${optionRow(stationSearch.selectedStationIndex === index)} px-4 py-2 text-sm text-black border-b border-gray-100 last:border-b-0`}
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

      {/* Mobile bottom sheet (the map keeps the space above it) */}
      {isMobile && (
        <MobileBottomSheet onHeightSettled={handleSheetHeightSettled}>
          {sidebarContent}
        </MobileBottomSheet>
      )}
    </div>
  );
}
