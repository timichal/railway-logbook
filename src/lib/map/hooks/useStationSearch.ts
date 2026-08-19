import { useCallback, useEffect, useRef, useState } from "react";
import type { RegionId } from "@/lib/regions";
import type { Station } from "@/lib/types";
import { searchStations } from "@/lib/userActions";

/**
 * Hook to manage station search with debouncing and keyboard navigation.
 * Results are limited to `region` - the map is locked to it, so a hit anywhere
 * else could not be flown to.
 */
export function useStationSearch(region: RegionId) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Station[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedStationIndex, setSelectedStationIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced station search
  const performSearch = useCallback(
    async (query: string) => {
      if (query.trim().length < 2) {
        setSearchResults([]);
        setShowSuggestions(false);
        setIsSearching(false);
        return;
      }

      setIsSearching(true);
      try {
        const results = await searchStations(query, region);
        setSearchResults(results);
        setShowSuggestions(results.length > 0);
        setSelectedStationIndex(-1);
      } catch (error) {
        console.error("Error searching stations:", error);
        setSearchResults([]);
        setShowSuggestions(false);
      } finally {
        setIsSearching(false);
      }
    },
    [region],
  );

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
