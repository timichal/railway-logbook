"use client";

import type * as maplibregl from "maplibre-gl";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import IconButton from "@/components/ui/IconButton";
import { fitCamera } from "@/lib/map/fitCamera";
import type { LineHighlight } from "@/lib/map/hooks/useLineSearchHighlight";
import { plural } from "@/lib/plural";
import { REGIONS, type RegionId } from "@/lib/shared/regions";
import type { LineSearchResult, MapSearchResults, Station } from "@/lib/shared/types";
import { optionRow } from "@/lib/ui/buttonStyles";
import { useSearchCombobox } from "@/lib/ui/useSearchCombobox";
import { searchMap } from "@/lib/userActions";

/** One entry of the box's list. */
type MapSearchResult =
  | { kind: "line"; line: LineSearchResult }
  | { kind: "station"; station: Station };

interface MapStationSearchProps {
  map: React.RefObject<maplibregl.Map | null>;
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
  search?: (query: string, region: RegionId) => Promise<MapSearchResults>;
  /** Placement classes, replacing the default top-corner position. */
  positionClassName?: string;
  /**
   * Map furniture that sits under the box, right-aligned: stacked below the line
   * chip, so the chip never lands on it.
   */
  children?: React.ReactNode;
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
  search = searchMap,
  positionClassName,
  children,
}: MapStationSearchProps) {
  const [query, setQuery] = useState("");
  // A new region drops the old one's search: its results lie outside the map's new
  // bounds, so they could be picked but not flown to
  // biome-ignore lint/correctness/useExhaustiveDependencies: region is the trigger.
  useEffect(() => setQuery(""), [region]);

  const withLines = REGIONS[region].hasRouteNames;
  const placeholder = withLines ? "Search lines and stations..." : "Search stations...";

  const handleSelect = (result: MapSearchResult) => {
    setQuery("");
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
  };

  // The lines lead the list: a query that names a line means it, where a station
  // name turning up inside a line name is incidental.
  const combobox = useSearchCombobox<MapSearchResult>({
    value: query,
    onChange: setQuery,
    search: async (q) => {
      const { lines, stations } = await search(q, region);
      return [
        ...lines.map((line) => ({ kind: "line" as const, line })),
        ...stations.map((station) => ({ kind: "station" as const, station })),
      ];
    },
    onSelect: handleSelect,
  });

  // The column is click-through; only what it shows takes a click, so the gaps
  // beside the chip and the furniture under it leave the map clickable.
  return (
    <div
      className={`absolute z-10 pointer-events-none ${
        positionClassName ?? (isMobile ? "top-3 left-3 right-14" : "top-4 right-12 w-80")
      } ${hidden ? "hidden" : ""}`}
    >
      <div className="relative pointer-events-auto">
        <input
          {...combobox.inputProps}
          aria-label={withLines ? "Search lines and stations" : "Search stations"}
          placeholder={placeholder}
          className="w-full px-4 py-2 pr-10 bg-surface border border-gray-300 rounded-lg shadow-lg text-fg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <Icon
          name="search"
          className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
        />

        {combobox.expanded && (
          <div
            {...combobox.listProps}
            role="listbox"
            aria-label={withLines ? "Lines and stations" : "Stations"}
            className="absolute top-full mt-1 w-full bg-surface border border-gray-200 rounded-lg shadow-xl max-h-80 overflow-y-auto z-20"
          >
            {combobox.results.map((result, index) => (
              <button
                type="button"
                key={
                  result.kind === "line"
                    ? `line:${result.line.name}`
                    : `station:${result.station.id}`
                }
                {...combobox.optionProps(index)}
                className={`${optionRow(combobox.activeIndex === index)} px-4 py-2 text-sm text-fg border-b border-gray-100 last:border-b-0`}
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

        {/* Only while there is no list: a refined query keeps the last one up */}
        {combobox.isSearching && !combobox.expanded && (
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
        <div className="pointer-events-auto mt-2 inline-flex max-w-full items-center gap-2 rounded-full bg-surface border border-gray-300 shadow-lg pl-3 pr-1 text-sm text-fg">
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
          <IconButton
            icon="close"
            label={`Stop highlighting ${lineHighlight.line.name}`}
            onClick={() => lineHighlight.setLine(null)}
            size="responsive"
          />
        </div>
      )}

      {children && <div className="pointer-events-auto mt-2 ml-auto w-fit">{children}</div>}
    </div>
  );
}
