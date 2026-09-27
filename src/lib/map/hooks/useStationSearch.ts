import { useCallback, useEffect, useRef, useState } from "react";
import type { RegionId } from "@/lib/shared/regions";
import type { Station } from "@/lib/shared/types";
import { searchStations } from "@/lib/userActions";

export type StationSearchFn = (query: string, region: RegionId) => Promise<Station[]>;

/**
 * Hook to manage station search with debouncing and keyboard navigation.
 * Results are limited to `region` - the map is locked to it, so a hit anywhere
 * else could not be flown to. `search` defaults to the user map's (near-route
 * stations only); pass a stable function, since a new one re-creates the search.
 */
export function useStationSearch(region: RegionId, search: StationSearchFn = searchStations) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Station[]>([]);
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
        const results = await search(query, region);
        if (requestId !== searchRequestRef.current) return;
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
