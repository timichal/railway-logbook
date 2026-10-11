"use client";

import type * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import { fitCamera } from "@/lib/map/fitCamera";
import type { LineHighlight } from "@/lib/map/hooks/useLineSearchHighlight";
import {
  type MapSearchResult,
  type StationSearchFn,
  useStationSearch,
} from "@/lib/map/hooks/useStationSearch";
import { plural } from "@/lib/plural";
import { REGIONS, type RegionId } from "@/lib/shared/regions";
import { iconBtn, optionRow } from "@/lib/ui/buttonStyles";
import { useCombobox } from "@/lib/ui/useCombobox";

interface MapStationSearchProps {
  map: React.MutableRefObject<maplibregl.Map | null>;
  /**
   * The map's searched-line highlight (`useLineSearchHighlight`): a picked line is
   * handed to it, and the box shows the chip that names and clears it. Without it a
   * line is only flown to.
   */
  lineHighlight?: LineHighlight;
  /** Results are limited to the region the map is locked to. */
  region: RegionId;
  isMobile: boolean;
  /** Stands the box down without unmounting it, so a typed query survives. */
  hidden?: boolean;
  /** Which stations to offer; the user map's near-route search by default. */
  search?: StationSearchFn;
  /** Placement classes, replacing the default top-corner position. */
  positionClassName?: string;
}

/**
 * The search box in the map's top corner: type a station name — or, where the region
 * names its lines, a line name — pick a result, and the map flies to it. A picked
 * line is also handed to the map's `lineHighlight` and named in a chip under the
 * box until the chip's x or the next line picked; a station picked meanwhile leaves
 * it be, since looking at a station on the line is the obvious next step. Shared by the interactive map, the
 * read-only shared one and the admin map.
 */
export default function MapStationSearch({
  map,
  lineHighlight,
  region,
  isMobile,
  hidden = false,
  search,
  positionClassName,
}: MapStationSearchProps) {
  const stationSearch = useStationSearch(region, search);
  const expanded =
    stationSearch.showSuggestions &&
    !stationSearch.isSearching &&
    stationSearch.searchResults.length > 0;
  const activeIndex = stationSearch.selectedStationIndex;
  // A combobox, as `StationSearchInput` is: focus stays in the input.
  const combobox = useCombobox({
    expanded,
    activeIndex,
    count: stationSearch.searchResults.length,
  });

  // The blur hides the list after a delay (see onBlur). A focus coming back inside
  // it must cancel that, or the list vanishes under a focused input.
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelBlurTimer = () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = null;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount only; the timer lives in a ref.
  useEffect(() => cancelBlurTimer, []);

  const withLines = REGIONS[region].hasRouteNames;
  const placeholder = withLines ? "Search lines and stations..." : "Search stations...";

  const handleSelect = (result: MapSearchResult) => {
    const m = map.current;
    if (!m) return;
    if (result.kind === "station") {
      const [lon, lat] = result.station.coordinates;
      m.flyTo({ center: [lon, lat], zoom: 14, duration: 1500 });
    } else {
      // The whole line in view, fitted as an opened journey is (clear of the
      // progress box, within the mobile sheet's camera padding).
      m.flyTo({ ...fitCamera(m, result.line.bounds, isMobile), duration: 1500 });
      lineHighlight?.setLine(result.line);
    }
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
          handleSelect(stationSearch.searchResults[stationSearch.selectedStationIndex]);
        }
        break;
      case "Escape":
        stationSearch.setShowSuggestions(false);
        stationSearch.setSelectedStationIndex(-1);
        break;
    }
  };

  return (
    <div
      className={`absolute z-10 ${
        positionClassName ?? (isMobile ? "top-3 left-3 right-14" : "top-4 right-12 w-80")
      } ${hidden ? "hidden" : ""}`}
    >
      <div className="relative">
        <input
          ref={stationSearch.searchInputRef}
          {...combobox.inputProps}
          type="text"
          aria-label={withLines ? "Search lines and stations" : "Search stations"}
          value={stationSearch.searchQuery}
          onChange={(e) => stationSearch.setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          onFocus={() => {
            cancelBlurTimer();
            if (stationSearch.searchQuery.length >= 2) stationSearch.setShowSuggestions(true);
          }}
          onBlur={() => {
            cancelBlurTimer();
            blurTimerRef.current = setTimeout(() => stationSearch.setShowSuggestions(false), 200);
          }}
          placeholder={placeholder}
          className="w-full px-4 py-2 pr-10 bg-surface border border-gray-300 rounded-lg shadow-lg text-fg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
        {expanded && (
          <div
            id={combobox.listId}
            role="listbox"
            aria-label={withLines ? "Lines and stations" : "Stations"}
            // Keeps the focus in the input: without it the pointerdown blurs the
            // field and the 200ms blur timer above hides the list before the
            // click lands — on touch, even scrolling the list did it.
            onPointerDown={(e) => e.preventDefault()}
            className="absolute top-full mt-1 w-full bg-surface border border-gray-200 rounded-lg shadow-xl max-h-80 overflow-y-auto z-20"
          >
            {stationSearch.searchResults.map((result, index) => (
              <button
                type="button"
                key={
                  result.kind === "line"
                    ? `line:${result.line.name}`
                    : `station:${result.station.id}`
                }
                {...combobox.optionProps(index)}
                onClick={() => handleSelect(result)}
                onMouseEnter={() => stationSearch.setSelectedStationIndex(index)}
                className={`${optionRow(activeIndex === index)} px-4 py-2 text-sm text-fg border-b border-gray-100 last:border-b-0`}
              >
                {result.kind === "line" ? (
                  <>
                    <div className="font-medium">{result.line.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Line · {plural(result.line.routeCount, "route")}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-medium">{result.station.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {withLines && "Station · "}
                      {result.station.coordinates[1].toFixed(4)},{" "}
                      {result.station.coordinates[0].toFixed(4)}
                    </div>
                  </>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Loading indicator */}
        {stationSearch.isSearching && (
          <div className="absolute top-full mt-1 w-full bg-surface border border-gray-200 rounded-lg shadow-xl p-3 z-20">
            <div className="flex items-center justify-center text-sm text-gray-500">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
              Searching...
            </div>
          </div>
        )}
      </div>

      {/* Outside the wrapper above, which the dropdown hangs from: inside it, the
          list would open below the chip rather than under the input. */}
      {lineHighlight?.line && (
        <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full bg-surface border border-gray-300 shadow-lg pl-3 pr-1 text-sm text-fg">
          {/* The band in miniature */}
          <span
            aria-hidden="true"
            className={`w-4 h-2.5 flex-shrink-0 rounded-full blur-[1px] ${lineHighlight.status === "drawn" ? "opacity-60" : "opacity-25"}`}
            style={{ backgroundColor: lineHighlight.color }}
          />
          <span className="truncate py-1">{lineHighlight.line.name}</span>
          {/* Nothing drawn for it: say why, rather than name a highlight that draws
              nothing. Picking the line again retries a failed load. */}
          {lineHighlight.status === "hidden" && (
            <span className="flex-shrink-0 text-xs text-gray-500">layer hidden</span>
          )}
          {lineHighlight.status === "failed" && (
            <span className="flex-shrink-0 text-xs text-red-600">failed to load</span>
          )}
          <button
            type="button"
            aria-label={`Stop highlighting ${lineHighlight.line.name}`}
            onClick={() => lineHighlight.setLine(null)}
            className={iconBtn("responsive")}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
