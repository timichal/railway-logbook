/**
 * The line picked in the map's search box, and the geometry its band is drawn from —
 * the web's `useLineSearchHighlight`, with the drawing left to `RailwayMap`'s
 * `<GeoJSONSource>`.
 *
 * Every pick fetches the line's merged geometry afresh, the same line again
 * included: picking it again is how a failed load is retried, and how the band
 * catches up with a route edited, renamed or deleted since. A region switch drops the
 * line: the other region has no such line, and coming back should not bring it back.
 *
 * Held by the map rather than by the search box, which closes on a pick: the band
 * and the chip that names it outlive the box.
 */
import type { UsageType } from "@shared/constants";
import type { RegionId } from "@shared/regions";
import type { LineGeometry, LineSearchResult } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { READ_TIMEOUT_MS } from "@/api/client";
import * as api from "@/api/endpoints";

/**
 * What the band is doing, for the chip: its geometry still on the way, drawn, every
 * route of the line on a layer switched off, or the geometry failed to load.
 */
export type LineHighlightStatus = "loading" | "drawn" | "hidden" | "failed";

export interface LineHighlight {
  line: LineSearchResult | null;
  setLine(line: LineSearchResult | null): void;
  /** The band's geometry for the current pick, once it has arrived. */
  geometry: LineGeometry[] | null;
  status: LineHighlightStatus;
}

export function useLineHighlight(
  regionId: RegionId,
  /** The usage types the map draws (`shownUsageTypes`). */
  shownTypes: readonly UsageType[],
): LineHighlight {
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
  const [pickRegion, setPickRegion] = useState(regionId);
  if (pickRegion !== regionId) {
    setPickRegion(regionId);
    setPick(null);
  }

  useEffect(() => {
    if (!pick) return;
    const controller = new AbortController();
    // A load that hasn't answered in time is a failure, as a failed one is
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, READ_TIMEOUT_MS);
    api
      .lineGeometry(regionId, pick.line.name, controller.signal)
      .then((lines) => setLoaded({ id: pick.id, lines }))
      .catch((error: unknown) => {
        // Aborted by the next pick or a region switch, which own the state now
        if (controller.signal.aborted && !timedOut) return;
        console.warn("Line geometry failed:", error);
        setLoaded({ id: pick.id, lines: null });
      })
      .finally(() => clearTimeout(deadline));
    return () => {
      clearTimeout(deadline);
      controller.abort();
    };
  }, [pick, regionId]);

  const result = pick && loaded?.id === pick.id ? loaded : null;

  let status: LineHighlightStatus = "loading";
  if (result) {
    // No geometry at all: the line was renamed or deleted since the search
    if (!result.lines || result.lines.length === 0) status = "failed";
    else if (pick?.line.usageTypes.some((type) => shownTypes.includes(type))) status = "drawn";
    else status = "hidden";
  }

  return {
    line: pick?.line ?? null,
    setLine,
    geometry: result?.lines ?? null,
    status,
  };
}
