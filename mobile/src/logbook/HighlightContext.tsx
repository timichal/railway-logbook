/**
 * What the map is lighting up on someone else's behalf — the web app's
 * `highlightedRoutes`, held where both halves can reach it.
 *
 * On the web the logbook sits in a sidebar beside the map, so opening a trip card
 * highlights its routes in the same glance. Here they are two tabs, so the highlight
 * is set by the logbook and *read* by the map, and the list says so by sending the
 * reader to the map rather than changing something they cannot see.
 *
 * The two kinds are the web's: **gold** for a Journey Planner result and **orange**
 * for browsing what has already been logged. They are one set rather than two,
 * because they answer the same question — what is the map pointing at right now —
 * and two at once would be two colours claiming to be the answer.
 *
 * Cleared on a region switch, like every other thing picked out of a region's map,
 * and when the session ends — a journey's highlight is that account's journey.
 *
 * **Opening something flies to it**, as on the web: a highlight set with `bounds`
 * asks the map to fit them, once. The ask waits here (`pendingFit`) rather than in
 * the map, because the map is in another tab and may not be looking — it fits when it
 * next is, and says so (`fitDone`), so a map built again later finds nothing to
 * replay. A later highlight replaces a fit not yet made, as it would on the web.
 */
import { HIGHLIGHT_COLORS } from "@shared/map/highlightLayers";
import type { PartialRouteGeometry, RouteBounds } from "@shared/types";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useOnSessionEnd } from "@/auth/useOnSessionEnd";
import { useRegion } from "@/region/RegionContext";

export type HighlightKind = "planner" | "view";

export interface Highlight {
  trackIds: number[];
  kind: HighlightKind;
  /** Routes covered only in part, drawn from their own geometry (see `HighlightOverlay`). */
  partials: PartialRouteGeometry[];
  /** What set it — so a card can tell whether the map is still showing *its* routes. */
  ownerKey: string | null;
  /** The box the map fits to, `null` when none of the routes is in this region. */
  bounds: RouteBounds | null;
  /**
   * A fit to `bounds` asked for and not yet made, by number — numbered so that the
   * map's `fitDone` for one ask cannot settle a newer one. Never set without `bounds`.
   */
  pendingFit: number | null;
}

const EMPTY: Highlight = {
  trackIds: [],
  kind: "view",
  partials: [],
  ownerKey: null,
  bounds: null,
  pendingFit: null,
};

interface HighlightValue extends Highlight {
  color: string;
  highlight(input: {
    trackIds: number[];
    kind?: HighlightKind;
    partials?: PartialRouteGeometry[];
    ownerKey?: string;
    /** Given, the map flies to it (see the header). */
    bounds?: RouteBounds | null;
  }): void;
  /** Asks the map to fit the current highlight again, if it has a box. */
  refit(): void;
  /** The map has made fit `id`. */
  fitDone(id: number): void;
  clear(): void;
}

const HighlightContext = createContext<HighlightValue | null>(null);

export function HighlightProvider({ children }: { children: ReactNode }): ReactNode {
  const { regionId } = useRegion();
  const [current, setCurrent] = useState<Highlight>(EMPTY);
  const fitCount = useRef(0);

  const clear = useCallback(() => setCurrent(EMPTY), []);

  const mountedRegion = useRef(regionId);
  useEffect(() => {
    if (mountedRegion.current === regionId) return;
    mountedRegion.current = regionId;
    clear();
  }, [regionId, clear]);

  useOnSessionEnd(clear);

  const highlight = useCallback<HighlightValue["highlight"]>((input) => {
    const bounds = input.bounds ?? null;
    setCurrent({
      trackIds: input.trackIds,
      kind: input.kind ?? "view",
      partials: input.partials ?? [],
      ownerKey: input.ownerKey ?? null,
      bounds,
      pendingFit: bounds ? ++fitCount.current : null,
    });
  }, []);

  const refit = useCallback(() => {
    const pendingFit = ++fitCount.current;
    setCurrent((prev) => (prev.bounds ? { ...prev, pendingFit } : prev));
  }, []);

  const fitDone = useCallback((id: number) => {
    setCurrent((prev) => (prev.pendingFit === id ? { ...prev, pendingFit: null } : prev));
  }, []);

  const value = useMemo(
    () => ({
      ...current,
      color: current.kind === "planner" ? HIGHLIGHT_COLORS.planner : HIGHLIGHT_COLORS.view,
      highlight,
      refit,
      fitDone,
      clear,
    }),
    [current, highlight, refit, fitDone, clear],
  );

  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
}

export function useHighlight(): HighlightValue {
  const value = useContext(HighlightContext);
  if (!value) throw new Error("useHighlight must be used inside a HighlightProvider");
  return value;
}
