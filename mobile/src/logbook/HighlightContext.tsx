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
 * Cleared on a region switch, like every other thing picked out of a region's map.
 */
import { HIGHLIGHT_COLORS } from "@shared/map/highlightLayers";
import type { PartialRouteGeometry } from "@shared/types";
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
import { useRegion } from "@/region/RegionContext";

export type HighlightKind = "planner" | "view";

export interface Highlight {
  trackIds: number[];
  kind: HighlightKind;
  /** Routes covered only in part, drawn from their own geometry (see `HighlightOverlay`). */
  partials: PartialRouteGeometry[];
  /** What set it — so a card can tell whether the map is still showing *its* routes. */
  ownerKey: string | null;
}

const EMPTY: Highlight = { trackIds: [], kind: "view", partials: [], ownerKey: null };

interface HighlightValue extends Highlight {
  color: string;
  highlight(input: {
    trackIds: number[];
    kind?: HighlightKind;
    partials?: PartialRouteGeometry[];
    ownerKey?: string;
  }): void;
  clear(): void;
}

const HighlightContext = createContext<HighlightValue | null>(null);

export function HighlightProvider({ children }: { children: ReactNode }): ReactNode {
  const { regionId } = useRegion();
  const [current, setCurrent] = useState<Highlight>(EMPTY);

  const mountedRegion = useRef(regionId);
  useEffect(() => {
    if (mountedRegion.current === regionId) return;
    mountedRegion.current = regionId;
    setCurrent(EMPTY);
  }, [regionId]);

  const highlight = useCallback<HighlightValue["highlight"]>((input) => {
    setCurrent({
      trackIds: input.trackIds,
      kind: input.kind ?? "view",
      partials: input.partials ?? [],
      ownerKey: input.ownerKey ?? null,
    });
  }, []);

  const clear = useCallback(() => setCurrent(EMPTY), []);

  const value = useMemo(
    () => ({
      ...current,
      color: current.kind === "planner" ? HIGHLIGHT_COLORS.planner : HIGHLIGHT_COLORS.view,
      highlight,
      clear,
    }),
    [current, highlight, clear],
  );

  return <HighlightContext.Provider value={value}>{children}</HighlightContext.Provider>;
}

export function useHighlight(): HighlightValue {
  const value = useContext(HighlightContext);
  if (!value) throw new Error("useHighlight must be used inside a HighlightProvider");
  return value;
}
