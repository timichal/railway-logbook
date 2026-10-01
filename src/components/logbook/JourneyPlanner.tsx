"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import StationSearchInput from "@/components/ui/StationSearchInput";
import { findRoutePathBetweenStations } from "@/lib/plannerActions";
import { useRegionId } from "@/lib/regionContext";
import { MAX_VIA_STATIONS } from "@/lib/shared/constants";
import type { HighlightRoutesFn, PlannerRoute, Station } from "@/lib/shared/types";
import { useToast } from "@/lib/toast";
import { btn, iconBtn, LINK_BTN } from "@/lib/ui/buttonStyles";
import { searchStations } from "@/lib/userActions";

interface SelectedStation {
  id: string | number;
  name: string;
}

type MaybeStation = SelectedStation | null;

/** A station input: from, to, or a via row by index. */
type SearchField = "from" | "to" | number;

interface JourneyPlannerProps {
  onHighlightRoutes?: HighlightRoutesFn;
  onAddRoutesToSelection?: (routes: PlannerRoute[]) => void;
  onStationClickHandler?: (handler: ((station: Station | null) => void) | null) => void;
}

export default function JourneyPlanner({
  onHighlightRoutes,
  onAddRoutesToSelection,
  onStationClickHandler,
}: JourneyPlannerProps) {
  const regionId = useRegionId();
  const { showSuccess } = useToast();
  const [fromStation, setFromStation] = useState<SelectedStation | null>(null);
  const [viaStations, setViaStations] = useState<MaybeStation[]>([]);
  const [toStation, setToStation] = useState<SelectedStation | null>(null);

  const [foundPath, setFoundPath] = useState<PlannerRoute[]>([]);
  const [totalDistance, setTotalDistance] = useState(0);
  const [pathError, setPathError] = useState<string | null>(null);
  const [isSearchingPath, setIsSearchingPath] = useState(false);

  // Station search for each input
  const [activeSearch, setActiveSearch] = useState<SearchField | null>(null);
  const [fromSearchQuery, setFromSearchQuery] = useState("");
  const [viaSearchQueries, setViaSearchQueries] = useState<string[]>([]);
  const [toSearchQuery, setToSearchQuery] = useState("");
  // Results remember the field they were fetched for: the three inputs share
  // one dropdown's worth of state, and tabbing From → To used to show From's
  // stations under To. Only the latest request may write (`searchRequestRef`).
  const [searchResultState, setSearchResultState] = useState<{
    field: SearchField | null;
    stations: Station[];
  }>({ field: null, stations: [] });
  const searchResults = searchResultState.field === activeSearch ? searchResultState.stations : [];
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchRequestRef = useRef(0);
  // Same guard for the path search, so a result from before a region switch or
  // an older click never paints its highlights over a newer one
  const pathRequestRef = useRef(0);

  // Any change to the stops invalidates a search still running for the old ones,
  // whose result would otherwise be painted over a form it no longer matches
  const cancelPathSearch = useCallback(() => {
    pathRequestRef.current++;
    setIsSearchingPath(false);
  }, []);

  // Refs for stable callback access (assigned during render, read only in callbacks)
  const activeSearchRef = useRef(activeSearch);
  const fromStationRef = useRef(fromStation);
  const toStationRef = useRef(toStation);
  const viaStationsRef = useRef(viaStations);
  const viaSearchQueriesRef = useRef(viaSearchQueries);
  activeSearchRef.current = activeSearch;
  fromStationRef.current = fromStation;
  toStationRef.current = toStation;
  viaStationsRef.current = viaStations;
  viaSearchQueriesRef.current = viaSearchQueries;

  const clearSearchResults = useCallback(() => {
    searchRequestRef.current++;
    setSearchResultState({ field: null, stations: [] });
  }, []);

  // Debounced station search, limited to the region on screen
  const performSearch = useCallback(
    async (field: SearchField, query: string) => {
      if (query.trim().length < 2) {
        clearSearchResults();
        return;
      }

      const requestId = ++searchRequestRef.current;
      try {
        const results = await searchStations(query, regionId);
        if (requestId !== searchRequestRef.current) return;
        setSearchResultState({ field, stations: results });
      } catch (error) {
        if (requestId !== searchRequestRef.current) return;
        console.error("Error searching stations:", error);
        setSearchResultState({ field: null, stations: [] });
      }
    },
    [regionId, clearSearchResults],
  );

  const handleSearchFocus = (field: SearchField, query: string) => {
    setActiveSearch(field);
    setSelectedIndex(-1);
    if (query.length >= 2) performSearch(field, query);
  };

  // Delayed so a click on a suggestion lands first. Tabbing to the next field
  // focuses it within those 200ms, so the timer only closes the dropdown if
  // this field is still the active one, and a search still debouncing for the
  // field being left is dropped rather than answered under the next one.
  const handleSearchBlur = (field: SearchField) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    setTimeout(() => {
      if (activeSearchRef.current !== field) return;
      setActiveSearch(null);
      clearSearchResults();
      setSelectedIndex(-1);
    }, 200);
  };

  // Handle search input change
  const handleSearchChange = (field: SearchField, value: string) => {
    cancelPathSearch();
    if (field === "from") {
      setFromSearchQuery(value);
      // Clear selection when user edits
      if (value !== fromStation?.name) {
        setFromStation(null);
      }
    } else if (field === "to") {
      setToSearchQuery(value);
      // Clear selection when user edits
      if (value !== toStation?.name) {
        setToStation(null);
      }
    } else {
      // Via station (field is the index)
      const newQueries = [...viaSearchQueries];
      newQueries[field] = value;
      setViaSearchQueries(newQueries);
      // Clear selection when user edits
      if (value !== viaStations[field]?.name) {
        const newStations = [...viaStations];
        newStations[field] = null; // Mark as unselected but keep the slot
        setViaStations(newStations);
      }
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (value.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(field, value);
      }, 300);
    } else {
      clearSearchResults();
      setSelectedIndex(-1);
    }
  };

  // Handle station selection
  const handleStationSelect = (station: Station) => {
    cancelPathSearch();
    const selected = { id: station.id, name: station.name };

    if (activeSearch === "from") {
      setFromStation(selected);
      setFromSearchQuery(station.name);
    } else if (activeSearch === "to") {
      setToStation(selected);
      setToSearchQuery(station.name);
    } else if (typeof activeSearch === "number") {
      // Via station
      const newStations = [...viaStations];
      newStations[activeSearch] = selected;
      setViaStations(newStations);
      const newQueries = [...viaSearchQueries];
      newQueries[activeSearch] = station.name;
      setViaSearchQueries(newQueries);
    }

    clearSearchResults();
    setSelectedIndex(-1);
  };

  // Handle station click from map - using refs to avoid dependency issues
  const handleStationClickFromMap = useCallback(
    (station: Station | null) => {
      // Guard against null station
      if (!station?.id || !station.name) {
        return;
      }

      const selected = { id: station.id, name: station.name };
      cancelPathSearch();

      // Use refs to get current values without causing re-creation
      const currentActiveSearch = activeSearchRef.current;
      const currentFromStation = fromStationRef.current;
      const currentToStation = toStationRef.current;
      const currentViaStations = viaStationsRef.current;
      const currentViaSearchQueries = viaSearchQueriesRef.current;

      // Logic: if activeSearch is set, use that field
      // Otherwise, fill from → to in order
      if (currentActiveSearch === "from" || (!currentFromStation && currentActiveSearch === null)) {
        setFromStation(selected);
        setFromSearchQuery(station.name);
      } else if (
        currentActiveSearch === "to" ||
        (currentFromStation && !currentToStation && currentActiveSearch === null)
      ) {
        setToStation(selected);
        setToSearchQuery(station.name);
      } else if (typeof currentActiveSearch === "number") {
        // Via station
        const newStations = [...currentViaStations];
        newStations[currentActiveSearch] = selected;
        setViaStations(newStations);
        const newQueries = [...currentViaSearchQueries];
        newQueries[currentActiveSearch] = station.name;
        setViaSearchQueries(newQueries);
      }
    },
    [cancelPathSearch],
  );

  // Register station click handler with parent on mount and when handler changes
  useEffect(() => {
    if (onStationClickHandler) {
      onStationClickHandler(handleStationClickFromMap);
    }
    // Cleanup: unregister handler when component unmounts
    return () => {
      if (onStationClickHandler) {
        onStationClickHandler(null);
      }
    };
  }, [onStationClickHandler, handleStationClickFromMap]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (searchResults.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : prev));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
          handleStationSelect(searchResults[selectedIndex]);
        }
        break;
      case "Escape":
        clearSearchResults();
        setSelectedIndex(-1);
        break;
    }
  };

  // Find path
  const handleFindPath = async () => {
    if (!fromStation || !toStation) {
      setPathError("Please select both from and to stations");
      return;
    }

    // Check if all via stations are filled
    const hasEmptyVia = viaStations.some((s) => s === null);
    if (hasEmptyVia) {
      setPathError("Please select all via stations or remove empty ones");
      return;
    }

    const requestId = ++pathRequestRef.current;
    setIsSearchingPath(true);
    setPathError(null);
    setFoundPath([]);

    try {
      // Convert station IDs to numbers, filtering out nulls
      const fromId =
        typeof fromStation.id === "string" ? parseInt(fromStation.id, 10) : fromStation.id;
      const toId = typeof toStation.id === "string" ? parseInt(toStation.id, 10) : toStation.id;
      const viaIds = viaStations
        .filter((s): s is SelectedStation => s !== null) // Filter out nulls
        .map((s) => (typeof s.id === "string" ? parseInt(s.id, 10) : s.id));

      const result = await findRoutePathBetweenStations(fromId, toId, viaIds);
      if (requestId !== pathRequestRef.current) return;

      if (result.error) {
        setPathError(result.error);
        setFoundPath([]);
        setTotalDistance(0);
        if (onHighlightRoutes) onHighlightRoutes([], "planner");
      } else {
        setFoundPath(result.routes);
        setTotalDistance(result.totalDistance);
        setPathError(null);
        if (onHighlightRoutes) {
          onHighlightRoutes(
            result.routes.map((r) => r.track_id),
            "planner",
            // Terminal routes joined mid-way are highlighted along the travelled
            // stretch only, so the gold line stops at the station
            result.routes.flatMap((r) => (r.partial ? [r.partial] : [])),
            { fit: true, bounds: result.bounds },
          );
        }
      }
    } catch (error) {
      if (requestId !== pathRequestRef.current) return;
      console.error("Error finding path:", error);
      setPathError("An error occurred while finding the path");
      setFoundPath([]);
      setTotalDistance(0);
    } finally {
      if (requestId === pathRequestRef.current) setIsSearchingPath(false);
    }
  };

  // Add routes to selection
  const handleAddToSelection = () => {
    if (foundPath.length === 0 || !onAddRoutesToSelection) return;

    onAddRoutesToSelection(foundPath);

    // Reset form after adding to selection
    resetForm();

    showSuccess(
      `${foundPath.length} route${foundPath.length !== 1 ? "s" : ""} added to selection!`,
    );
  };

  // Clear all fields
  const resetForm = () => {
    cancelPathSearch();
    setFoundPath([]);
    setTotalDistance(0);
    setPathError(null);
    setFromStation(null);
    setToStation(null);
    setViaStations([]);
    setFromSearchQuery("");
    setToSearchQuery("");
    setViaSearchQueries([]);
    if (onHighlightRoutes) onHighlightRoutes([], "planner");
  };

  // Switching regions empties the form: the stations in it belong to the region
  // that just went off screen, and searching from them would plot a path the map
  // cannot show.
  // biome-ignore lint/correctness/useExhaustiveDependencies: regionId is the trigger; resetForm is redefined every render and must not re-run this.
  useEffect(() => {
    resetForm();
  }, [regionId]);

  // Add new via station
  const addViaStation = () => {
    cancelPathSearch();
    setViaStations([...viaStations, null]);
    setViaSearchQueries([...viaSearchQueries, ""]);
  };

  // Remove via station
  const removeViaStation = (index: number) => {
    cancelPathSearch();
    setViaStations(viaStations.filter((_, i) => i !== index));
    setViaSearchQueries(viaSearchQueries.filter((_, i) => i !== index));
  };

  // Reorder via stations. Buttons rather than the HTML5 drag-and-drop this used to
  // use: iOS Safari never fires `dragstart` from a touch, so the drag handle was
  // dead on a phone with nothing to say so — and a 16px handle was barely a target
  // even where it worked. Two taps also give keyboard users the reordering that
  // drag-and-drop had no equivalent for.
  const moveViaStation = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= viaStations.length) return;
    cancelPathSearch();

    // The station and its query text are parallel arrays keyed by position, so both
    // move together or the row would show someone else's name.
    const swap = <T,>(list: T[]): T[] => {
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    };
    setViaStations(swap(viaStations));
    setViaSearchQueries(swap(viaSearchQueries));
  };

  return (
    <div className="space-y-3 text-fg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold">Journey Planner</h3>
        <button type="button" onClick={resetForm} className={LINK_BTN}>
          Clear all
        </button>
      </div>

      {/* From Station */}
      <StationSearchInput
        id="planner-from-station"
        label="From Station"
        value={fromSearchQuery}
        placeholder="Search from station..."
        isSelected={!!fromStation}
        selectedClassName="border-blue-300 bg-blue-50"
        showClear={!!fromStation}
        clearLabel="Clear from station"
        showResults={activeSearch === "from"}
        searchResults={searchResults}
        selectedIndex={selectedIndex}
        onChange={(value) => handleSearchChange("from", value)}
        onKeyDown={handleKeyDown}
        onFocus={() => handleSearchFocus("from", fromSearchQuery)}
        onBlur={() => handleSearchBlur("from")}
        onSelectResult={handleStationSelect}
        onHoverResult={setSelectedIndex}
        onClear={() => {
          cancelPathSearch();
          setFromStation(null);
          setFromSearchQuery("");
        }}
      />

      {/* Via Stations */}
      {viaStations.map((station, viaIndex) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: via rows are positional parallel arrays (viaStations[i] ↔ viaSearchQueries[i]) reordered together, so the index is the row identity.
          key={viaIndex}
          className="flex items-center gap-1"
        >
          {/* Only worth the width once there is something to reorder. */}
          {viaStations.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => moveViaStation(viaIndex, -1)}
                disabled={viaIndex === 0}
                aria-label={`Move via station ${viaIndex + 1} up`}
                className={`${iconBtn("responsive")} text-xs`}
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => moveViaStation(viaIndex, 1)}
                disabled={viaIndex === viaStations.length - 1}
                aria-label={`Move via station ${viaIndex + 1} down`}
                className={`${iconBtn("responsive")} text-xs`}
              >
                ▼
              </button>
            </>
          )}
          <StationSearchInput
            containerClassName="flex-1"
            label={`Via station ${viaIndex + 1}`}
            hideLabel
            value={viaSearchQueries[viaIndex] || ""}
            placeholder={`Search via station ${viaIndex + 1}...`}
            isSelected={!!station}
            selectedClassName="border-green-300 bg-green-50"
            showClear={true}
            clearLabel={`Remove via station ${viaIndex + 1}`}
            showResults={activeSearch === viaIndex}
            searchResults={searchResults}
            selectedIndex={selectedIndex}
            onChange={(value) => handleSearchChange(viaIndex, value)}
            onKeyDown={handleKeyDown}
            onFocus={() => handleSearchFocus(viaIndex, viaSearchQueries[viaIndex] || "")}
            onBlur={() => handleSearchBlur(viaIndex)}
            onSelectResult={handleStationSelect}
            onHoverResult={setSelectedIndex}
            onClear={() => removeViaStation(viaIndex)}
          />
        </div>
      ))}

      {/* Add Via Station Button. Stops at MAX_VIA_STATIONS, which the search
          refuses beyond — the button says so rather than letting the form build
          a request that comes back as an error. */}
      <button
        type="button"
        onClick={addViaStation}
        disabled={viaStations.length >= MAX_VIA_STATIONS}
        className="w-full px-3 py-2 border-2 border-dashed border-gray-300 rounded-md text-sm font-medium text-gray-600 transition-colors disabled:opacity-50 not-disabled:hover:border-gray-400 not-disabled:hover:text-gray-800 not-disabled:hover:bg-gray-50 not-disabled:active:bg-gray-100"
      >
        {viaStations.length >= MAX_VIA_STATIONS
          ? `Maximum of ${MAX_VIA_STATIONS} via stations`
          : "+ Add via station"}
      </button>

      {/* To Station */}
      <StationSearchInput
        id="planner-to-station"
        label="To Station"
        value={toSearchQuery}
        placeholder="Search to station..."
        isSelected={!!toStation}
        selectedClassName="border-blue-300 bg-blue-50"
        showClear={!!toStation}
        clearLabel="Clear to station"
        showResults={activeSearch === "to"}
        searchResults={searchResults}
        selectedIndex={selectedIndex}
        onChange={(value) => handleSearchChange("to", value)}
        onKeyDown={handleKeyDown}
        onFocus={() => handleSearchFocus("to", toSearchQuery)}
        onBlur={() => handleSearchBlur("to")}
        onSelectResult={handleStationSelect}
        onHoverResult={setSelectedIndex}
        onClear={() => {
          cancelPathSearch();
          setToStation(null);
          setToSearchQuery("");
        }}
      />

      {/* Find Path Button */}
      <button
        type="button"
        onClick={handleFindPath}
        disabled={!fromStation || !toStation || isSearchingPath}
        className={`${btn("primary", "md")} w-full`}
      >
        {isSearchingPath ? "Finding path..." : "Find Path"}
      </button>

      {/* Path Error */}
      {pathError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {pathError}
        </div>
      )}

      {/* Found Path */}
      {foundPath.length > 0 && (
        <div>
          <div className="mb-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
            <span className="font-medium text-green-800">
              Found {foundPath.length} route{foundPath.length !== 1 ? "s" : ""} (
              {totalDistance.toFixed(1)} km)
            </span>
          </div>

          <div className="space-y-1 mb-3 max-h-64 overflow-y-auto bg-gray-50 border border-gray-200 rounded">
            {foundPath.map((route, index) => (
              <div key={route.track_id} className="p-2 text-xs">
                <div className="font-medium">
                  {index + 1}. {route.from_station} ⟷ {route.to_station}
                  <span className="text-gray-600"> {route.travelled_length_km.toFixed(1)} km</span>
                  {route.partial && (
                    <span className="ml-1 text-amber-700">
                      (partial, of {route.length_km.toFixed(1)} km)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleAddToSelection}
            className={`${btn("primary", "md")} w-full`}
          >
            Add Routes to Selection
          </button>
        </div>
      )}
    </div>
  );
}
