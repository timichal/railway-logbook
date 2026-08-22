"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPublicDataAccess } from "@/lib/dataAccess";
import {
  createPublicNotesSource,
  createPublicStationsSource,
  createRailwayRoutesSource,
} from "@/lib/map";
import { useCoverageOverlay } from "@/lib/map/hooks/useCoverageOverlay";
import { useLayerFilters } from "@/lib/map/hooks/useLayerFilters";
import { useMapLibre } from "@/lib/map/hooks/useMapLibre";
import { useRouteEditor } from "@/lib/map/hooks/useRouteEditor";
import { useStationSearch } from "@/lib/map/hooks/useStationSearch";
import { setupUserMapInteractions } from "@/lib/map/interactions/userMapInteractions";
import { loadLayerPrefs, saveLayerPref } from "@/lib/map/layerPrefs";
import { createUserMapLayers } from "@/lib/map/userMapLayers";
import { useRegion } from "@/lib/regionContext";
import { regionCountryCodes } from "@/lib/regions";
import type { Station } from "@/lib/types";

interface PublicRailwayMapProps {
  /** Sharing token from the URL — stands in for a session on every data call. */
  token: string;
  /** The owner whose rides colour the routes. Only used for the tile query. */
  ownerId: number;
  /** The owner's country filter, shown exactly as they set it. */
  selectedCountries: string[];
  isMobile: boolean;
}

/**
 * The read-only map behind a share link.
 *
 * Same sources, layers and styling as the interactive map (both build them from
 * `userMapLayers`), coloured by the *owner's* rides via the tile's `user_id`
 * parameter. What is missing is everything that writes or picks: no sidebar, no
 * route selection, no journey planner, no country controls. Hover popups and the
 * layer toggles stay — they only change what the visitor is looking at.
 */
export default function PublicRailwayMap({
  token,
  ownerId,
  selectedCountries,
  isMobile,
}: PublicRailwayMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const region = useRegion();
  const dataAccess = useMemo(() => createPublicDataAccess(token, region.id), [token, region.id]);

  // Same rule as the interactive map: a single-country region pins the filter to
  // its own list, which is what keeps the other region's network out of view.
  const effectiveCountries = useMemo(
    () => (region.hasCountryFilter ? selectedCountries : regionCountryCodes(region.id)),
    [region, selectedCountries],
  );

  const [showScenicOutline, setShowScenicOutline] = useState<boolean>(
    () => loadLayerPrefs().showScenicOutline,
  );

  const stationSearch = useStationSearch(region.id);

  const { map, mapLoaded } = useMapLibre(
    mapContainer,
    {
      region: region.id,
      sources: {
        railway_routes: createRailwayRoutesSource({
          userId: ownerId,
          selectedCountries: effectiveCountries,
        }),
        stations: createPublicStationsSource(),
        public_notes: createPublicNotesSource(),
      },
      layers: createUserMapLayers(),
    },
    [ownerId, effectiveCountries, region.id],
  );

  // Progress figures and the heritage/special toggles. Nothing here logs a
  // journey, so there is no tile refresh to drive and no cache buster to pass.
  const routeEditor = useRouteEditor(dataAccess, effectiveCountries);

  useCoverageOverlay(map, mapLoaded, dataAccess, effectiveCountries, 0, 0);
  useLayerFilters(
    map,
    routeEditor.showHeritage,
    routeEditor.showSpecial,
    showScenicOutline,
    mapLoaded,
  );

  useEffect(() => {
    if (mapLoaded) routeEditor.refreshProgress();
  }, [mapLoaded, routeEditor.refreshProgress]);

  // Hover popups only: `onRouteClick` is deliberately omitted, so no click
  // handler is attached and there is nothing to select.
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    let cleanup: (() => void) | undefined;

    const setupWhenReady = () => {
      if (!map.current?.getLayer("railway_routes")) return;
      cleanup = setupUserMapInteractions(map.current, {});
    };

    if (!map.current.isMoving()) {
      setupWhenReady();
    } else {
      map.current.once("idle", setupWhenReady);
    }

    return () => {
      if (cleanup) cleanup();
    };
  }, [map, mapLoaded]);

  const handleStationSelect = (station: Station) => {
    if (!map.current) return;
    const [lon, lat] = station.coordinates;
    map.current.flyTo({ center: [lon, lat], zoom: 14, duration: 1500 });
    stationSearch.setSearchQuery("");
    stationSearch.setShowSuggestions(false);
    stationSearch.setSelectedStationIndex(-1);
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

  return (
    <div className="h-full w-full relative">
      <div ref={mapContainer} className="w-full h-full" style={{ minHeight: "400px" }} />

      {/* Progress Stats Box */}
      {routeEditor.progress && (
        <div
          className={`absolute bg-white p-3 rounded shadow-lg text-black z-10 ${
            isMobile ? "bottom-10 left-3 text-xs" : "bottom-10 right-4"
          }`}
        >
          <h3 className={`font-bold mb-2 ${isMobile ? "text-xs" : "text-sm"}`}>Completed</h3>
          <div className={`font-semibold ${isMobile ? "text-sm" : "text-lg"}`}>
            {routeEditor.progress.completedKm}/{routeEditor.progress.totalKm} km
          </div>
          <div className={`font-bold text-green-600 ${isMobile ? "text-lg" : "text-2xl"}`}>
            {routeEditor.progress.percentage}%
          </div>
          <div className="text-xs text-gray-600 mt-1">
            {routeEditor.progress.completedRoutes}/{routeEditor.progress.totalRoutes} (
            {routeEditor.progress.routePercentage}%) routes
          </div>
          <div className="mt-2 pt-2 border-t border-gray-200">
            <label className="flex items-center gap-2 cursor-pointer text-xs mb-2">
              <input
                type="checkbox"
                checked={routeEditor.showHeritage}
                onChange={() => routeEditor.toggleShowHeritage()}
                className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
              />
              <span>Show heritage &amp; tourist lines</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-xs mb-2">
              <input
                type="checkbox"
                checked={routeEditor.showSpecial}
                onChange={() => routeEditor.toggleShowSpecial()}
                className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
              />
              <span>{region.id === "japan" ? "Show non-JR lines" : "Show special services"}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={showScenicOutline}
                onChange={(e) => {
                  setShowScenicOutline(e.target.checked);
                  saveLayerPref("showScenicOutline", e.target.checked);
                }}
                className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
              />
              <span>Highlight scenic lines</span>
            </label>
          </div>
        </div>
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

          {stationSearch.showSuggestions &&
            !stationSearch.isSearching &&
            stationSearch.searchResults.length > 0 && (
              <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-80 overflow-y-auto z-20">
                {stationSearch.searchResults.map((station, index) => (
                  <button
                    type="button"
                    key={station.id}
                    onClick={() => handleStationSelect(station)}
                    onMouseEnter={() => stationSearch.setSelectedStationIndex(index)}
                    className={`w-full px-4 py-2 text-left text-sm text-black hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0 ${
                      stationSearch.selectedStationIndex === index ? "bg-blue-50" : ""
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
  );
}
