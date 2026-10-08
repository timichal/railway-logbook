import { useCallback, useEffect, useRef, useState } from "react";
import type { RegionId } from "@/lib/shared/regions";
import type { LineSearchResult, MapSearchResults, Station } from "@/lib/shared/types";
import { searchMap } from "@/lib/userActions";

export type StationSearchFn = (query: string, region: RegionId) => Promise<MapSearchResults>;

/** One entry of the map search box's list. */
export type MapSearchResult =
  | { kind: "line"; line: LineSearchResult }
  | { kind: "station"; station: Station };

/**
 * Hook to manage the map's search box with debouncing and keyboard navigation.
 * Results are limited to `region` - the map is locked to it, so a hit anywhere
 * else could not be flown to. `search` defaults to the user map's (near-route
 * stations only); pass a stable function, since a new one re-creates the search.
 * In a region that names its lines (`hasRouteNames`) it returns line names too, and
 * the lines lead the list: a query that names a line
 * means it, where a station name turning up inside a line name is incidental.
 */
export function useStationSearch(region: RegionId, search: StationSearchFn = searchMap) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MapSearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedStationIndex, setSelectedStationIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Only the latest request may write: "Pra" answering after "Praha hl.n."
  // replaced the longer query's results, and its `finally` stopped the spinner
  // while the newer search was still running.
  const searchRequestRef = useRef(0);

  // Debounced station search
  const performSearch = useCallback(
    async (query: string) => {
      const requestId = ++searchRequestRef.current;
      if (query.trim().length < 2) {
        setSearchResults([]);
        setShowSuggestions(false);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      try {
        const { lines, stations } = await search(query, region);
        if (requestId !== searchRequestRef.current) return;
        const results: MapSearchResult[] = [
          ...lines.map((line) => ({ kind: "line" as const, line })),
          ...stations.map((station) => ({ kind: "station" as const, station })),
        ];
        setSearchResults(results);
        setShowSuggestions(results.length > 0);
        setSelectedStationIndex(-1);
      } catch (error) {
        if (requestId !== searchRequestRef.current) return;
        console.error("Error searching stations:", error);
        setSearchResults([]);
        setShowSuggestions(false);
      } finally {
        if (requestId === searchRequestRef.current) setIsSearching(false);
      }
    },
    [region, search],
  );

  // A new region drops the old one's search: its results could be picked and
  // flown to, and they lie outside the map's new bounds
  // biome-ignore lint/correctness/useExhaustiveDependencies: region is the trigger; the setters are stable.
  useEffect(() => {
    searchRequestRef.current++;
    setSearchQuery("");
    setSearchResults([]);
    setShowSuggestions(false);
    setSelectedStationIndex(-1);
    setIsSearching(false);
  }, [region]);

  // Debounce search queries
  useEffect(() => {
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Set new timeout for search
    if (searchQuery.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(searchQuery);
      }, 300); // 300ms debounce
    } else {
      // Drop a search still in flight, or it would refill the cleared box
      searchRequestRef.current++;
      setSearchResults([]);
      setShowSuggestions(false);
      setIsSearching(false);
    }

    // Cleanup
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, performSearch]);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    showSuggestions,
    setShowSuggestions,
    selectedStationIndex,
    setSelectedStationIndex,
    isSearching,
    searchInputRef,
  };
}
