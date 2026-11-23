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
 *
 * A fit can also be asked **without a highlight** (`fitTo`): editing a saved journey
 * flies to it, but its routes are drawn as the selection, and an orange copy of them
 * as saved would go on showing a route the edit has just removed. The ask carries its
 * own box for this, so it never replaces the highlight's (`bounds`, which `refit`
 * flies to again), and the journey it is for: one closed before the map could fly
 * (a style still loading) drops the ask, rather than fly to routes no longer drawn.
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
import { useSelection } from "@/logbook/SelectionContext";
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
   * A fit asked for and not yet made, by number — numbered so that the map's
   * `fitDone` for one ask cannot settle a newer one — with the box to fit: the
   * highlight's own, or one asked by `fitTo`.
   */
  pendingFit: { id: number; bounds: RouteBounds; journeyId?: number } | null;
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
  /**
   * Asks the map to fit the open journey `journeyId`'s `bounds`, leaving the
   * highlight as it is (see the header).
   */
  fitTo(bounds: RouteBounds, journeyId: number): void;
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
      pendingFit: bounds ? { id: ++fitCount.current, bounds } : null,
    });
  }, []);

  const refit = useCallback(() => {
    const id = ++fitCount.current;
    setCurrent((prev) =>
      prev.bounds ? { ...prev, pendingFit: { id, bounds: prev.bounds } } : prev,
    );
  }, []);

  const fitTo = useCallback((bounds: RouteBounds, journeyId: number) => {
    const id = ++fitCount.current;
    setCurrent((prev) => ({ ...prev, pendingFit: { id, bounds, journeyId } }));
  }, []);

  const openJourney = useSelection().editing?.journeyId ?? null;
  useEffect(() => {
    setCurrent((prev) => {
      const forJourney = prev.pendingFit?.journeyId;
      return forJourney !== undefined && forJourney !== openJourney
        ? { ...prev, pendingFit: null }
        : prev;
    });
  }, [openJourney]);

  const fitDone = useCallback((id: number) => {
    setCurrent((prev) => (prev.pendingFit?.id === id ? { ...prev, pendingFit: null } : prev));
  }, []);

  const value = useMemo(
    () => ({
      ...current,
      color: current.kind === "planner" ? HIGHLIGHT_COLORS.planner : HIGHLIGHT_COLORS.view,
      highlight,
      refit,
      fitTo,
      fitDone,
      clear,
    }),
    [current, highlight, refit, fitTo, fitDone, clear],
  );

  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
}

export function useHighlight(): HighlightValue {
  const value = useContext(HighlightContext);
  if (!value) throw new Error("useHighlight must be used inside a HighlightProvider");
  return value;
}
