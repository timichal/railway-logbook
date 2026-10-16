import type * as maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UsageType } from "@/lib/shared/constants";
import {
  createLineSearchHighlightLayer,
  LINE_SEARCH_HIGHLIGHT_LAYER_ID,
  LINE_SEARCH_HIGHLIGHT_SOURCE_ID,
  LINE_SEARCH_HIGHLIGHT_TOLERANCE,
  lineSearchHighlightColor,
  lineSearchHighlightData,
} from "@/lib/shared/map/highlightLayers";
import { REGULAR_ROUTE_LAYER_ID, usageTypeFilter } from "@/lib/shared/map/layers";
import type { RegionId } from "@/lib/shared/regions";
import type { LineGeometry, LineSearchResult } from "@/lib/shared/types";
import { useResolvedTheme } from "@/lib/theme";
import { getLineGeometry } from "@/lib/userActions";

/**
 * What the band is doing, for the chip: its geometry still on the way, drawn, every
 * route of the line on a layer switched off, or the geometry failed to load.
 */
type LineHighlightStatus = "loading" | "drawn" | "hidden" | "failed";

/** A map's searched-line highlight, as `MapStationSearch` shows and sets it. */
export interface LineHighlight {
  line: LineSearchResult | null;
  setLine: (line: LineSearchResult | null) => void;
  status: LineHighlightStatus;
  color: string;
}

/**
 * The line picked in the map's search box, and its band on the map — see
 * `createLineSearchHighlightLayer`. Held by the map rather than by the search box,
 * since what it draws depends on the map's own layer visibility. Works on any map
 * whose route layers start with `railway_routes`, which is all three.
 *
 * Every pick fetches the line's merged geometry afresh, the same line again
 * included: picking it again is how a failed load is retried, and how the band
 * catches up with a route edited, renamed or deleted since. The band appears when
 * the geometry arrives. A region switch drops the line: the other region has no
 * such line, and coming back should not bring it back. The band goes in directly
 * under the route lines — above the scenic band, so the searched line wins where
 * the two meet.
 */
export function useLineSearchHighlight(
  map: React.RefObject<maplibregl.Map | null>,
  /** Re-applies the band to a freshly built map (scheme change). */
  mapLoaded: boolean,
  region: RegionId,
  /** The usage types whose route layers are shown; pass a stable array. */
  usageTypes: readonly UsageType[],
  /**
   * Stands the band down while the search box is hidden (a short map strip): the
   * box's chip is the only way to clear it, and a highlight nothing can clear is
   * stuck.
   */
  hidden = false,
): LineHighlight {
  const theme = useResolvedTheme();
  // Each pick numbered, so a re-pick of the same line is a new fetch and a late
  // answer for an earlier pick is told apart from the current one's
  const [pick, setPick] = useState<{ id: number; line: LineSearchResult } | null>(null);
  const [loaded, setLoaded] = useState<{ id: number; lines: LineGeometry[] | null } | null>(null);
  const pickCount = useRef(0);
  const setLine = useCallback((line: LineSearchResult | null) => {
    pickCount.current += 1;
    setPick(line ? { id: pickCount.current, line } : null);
  }, []);

  // Reset during render, so no frame shows the old region's line on the new one
  const [pickRegion, setPickRegion] = useState(region);
  if (pickRegion !== region) {
    setPickRegion(region);
    setPick(null);
  }

  useEffect(() => {
    if (!pick) return;
    let current = true;
    getLineGeometry(pick.line.name, region)
      .then((lines) => {
        if (current) setLoaded({ id: pick.id, lines });
      })
      .catch((error) => {
        console.error("Error loading line geometry:", error);
        if (current) setLoaded({ id: pick.id, lines: null });
      });
    return () => {
      current = false;
    };
  }, [pick, region]);

  const result = pick && loaded?.id === pick.id ? loaded : null;
  const lines = !hidden && result?.lines ? result.lines : null;

  // The geometry: emptied rather than removed when there is none, so nothing has to
  // find its place in the stack again. Only here is the data handed to MapLibre,
  // whose worker re-tiles the whole line on every setData.
  // biome-ignore lint/correctness/useExhaustiveDependencies: usageTypes and theme are read only when the layer is first added — the filter effect below keeps usageTypes current, and a scheme change rebuilds the map (mapLoaded)
  useEffect(() => {
    const m = map.current;
    if (!mapLoaded || !m) return;

    const data = lineSearchHighlightData(lines ?? []);
    const source = m.getSource(LINE_SEARCH_HIGHLIGHT_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (source) {
      source.setData(data);
      return;
    }
    if (!lines) return;

    m.addSource(LINE_SEARCH_HIGHLIGHT_SOURCE_ID, {
      type: "geojson",
      data,
      tolerance: LINE_SEARCH_HIGHLIGHT_TOLERANCE,
    });
    const beforeId = m.getLayer(REGULAR_ROUTE_LAYER_ID) ? REGULAR_ROUTE_LAYER_ID : undefined;
    m.addLayer(
      createLineSearchHighlightLayer(usageTypes, theme) as maplibregl.LayerSpecification,
      beforeId,
    );
  }, [map, mapLoaded, lines]);

  // The layer switches: a filter change, the data left alone
  useEffect(() => {
    const m = map.current;
    if (!mapLoaded || !m?.getLayer(LINE_SEARCH_HIGHLIGHT_LAYER_ID)) return;
    m.setFilter(
      LINE_SEARCH_HIGHLIGHT_LAYER_ID,
      usageTypeFilter(usageTypes) as maplibregl.FilterSpecification,
    );
  }, [map, mapLoaded, usageTypes]);

  let status: LineHighlightStatus = "loading";
  if (result) {
    if (!result.lines) status = "failed";
    else if (pick?.line.usageTypes.some((type) => usageTypes.includes(type))) status = "drawn";
    else status = "hidden";
  }

  return {
    line: pick?.line ?? null,
    setLine,
    status,
    color: lineSearchHighlightColor(theme),
  };
}
