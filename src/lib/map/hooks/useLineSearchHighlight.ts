import type * as maplibregl from "maplibre-gl";
import { useEffect, useState } from "react";
import type { UsageType } from "@/lib/shared/constants";
import {
  createLineSearchHighlightLayers,
  LINE_SEARCH_HIGHLIGHT_LAYER_IDS,
  lineSearchHighlightColor,
  lineSearchHighlightFilter,
} from "@/lib/shared/map/highlightLayers";
import type { RegionId } from "@/lib/shared/regions";
import type { LineSearchResult } from "@/lib/shared/types";
import { useResolvedTheme } from "@/lib/theme";

/** A map's searched-line highlight, as `MapStationSearch` shows and sets it. */
export interface LineHighlight {
  line: LineSearchResult | null;
  setLine: (line: LineSearchResult | null) => void;
  /** Whether any of the line's routes is drawn, i.e. not all hidden by layer switches. */
  drawn: boolean;
  color: string;
}

/**
 * The line picked in the map's search box, and its outline on the map — see
 * `createLineSearchHighlightLayers`. Held by the map rather than by the search box,
 * since what it draws depends on the map's own layer visibility. Works on any map
 * with a `railway_routes` source, which is all three.
 *
 * A region switch drops the line: the other region has no such line, and coming
 * back should not bring it back. The outline goes in above the route lines (and
 * the coverage overlay) but under the stations and the other highlights, and is
 * cleared by filtering it to nothing rather than removing it, for the reason
 * `syncHighlightOverlay` gives.
 */
export function useLineSearchHighlight(
  map: React.MutableRefObject<maplibregl.Map | null>,
  /** Re-applies the outline to a freshly built map (scheme change). */
  mapLoaded: boolean,
  region: RegionId,
  /** The usage types whose route layers are shown; pass a stable array. */
  usageTypes: readonly UsageType[],
  /**
   * Stands the outline down while the search box is hidden (a short map strip):
   * the box's chip is the only way to clear it, and an outline nothing can clear
   * is stuck.
   */
  hidden = false,
): LineHighlight {
  const theme = useResolvedTheme();
  const [line, setLine] = useState<LineSearchResult | null>(null);
  // Reset during render, so no frame shows the old region's line on the new one
  const [lineRegion, setLineRegion] = useState(region);
  if (lineRegion !== region) {
    setLineRegion(region);
    setLine(null);
  }

  const name = hidden ? null : (line?.name ?? null);

  useEffect(() => {
    const m = map.current;
    if (!mapLoaded || !m?.getSource("railway_routes")) return;

    const filter = lineSearchHighlightFilter(name, usageTypes) as maplibregl.FilterSpecification;
    if (m.getLayer(LINE_SEARCH_HIGHLIGHT_LAYER_IDS[0])) {
      for (const id of LINE_SEARCH_HIGHLIGHT_LAYER_IDS) m.setFilter(id, filter);
      return;
    }
    if (name === null) return;

    const beforeId = m.getLayer("stations") ? "stations" : undefined;
    for (const layer of createLineSearchHighlightLayers(name, usageTypes, theme)) {
      m.addLayer(layer as maplibregl.LayerSpecification, beforeId);
    }
  }, [map, mapLoaded, name, usageTypes, theme]);

  return {
    line,
    setLine,
    drawn: line?.usageTypes.some((type) => usageTypes.includes(type)) ?? false,
    color: lineSearchHighlightColor(theme),
  };
}
