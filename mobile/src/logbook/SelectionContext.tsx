/**
 * The Route Logger's selection: which routes are about to be logged as a journey.
 *
 * The web app keeps this in `MainLayout` and passes it down the sidebar; here it is
 * a context, because the two halves that need it are in different places on the
 * navigation tree — the map (which both adds to it and highlights it) and the
 * logging screen (which spends it). A tab bar between them rules out props.
 *
 * A selection is made *on a region's map*, so **switching region clears it**, as the
 * web app clears its own. The alternative is a journey logged in Europe carrying a
 * route in Japan, which nothing downstream would reject.
 *
 * What is held per route is the tile feature itself plus the two logging decisions
 * (`partial` and, where it is known, the stretch). Keeping the whole feature means
 * the logging screen renders a route with the same `routeTitle`/`routeBadges` the
 * map sheet does, rather than a second, thinner description of the same thing.
 */
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
import type { RouteFeature } from "@/map/mapFeatures";
import { useRegion } from "@/region/RegionContext";

export interface SelectedRoute {
  route: RouteFeature;
  /** Ridden only in part. Ticked by hand, or arriving already ticked from the planner. */
  partial: boolean;
  /**
   * Which stretch, when it is known — only the Journey Planner produces one, for a
   * route it joins between the endpoints. Null means "partial, extent unknown",
   * which is what a route ticked by hand looks like.
   */
  covered: PartialRouteGeometry | null;
}

interface SelectionValue {
  selected: SelectedRoute[];
  /** Whether this route is in the selection — what the map sheet's button reads. */
  isSelected(trackId: number): boolean;
  /** Add it, or remove it if it is already there. Adds unticked: a tap is a whole ride. */
  toggle(route: RouteFeature, covered?: PartialRouteGeometry | null): void;
  /** Add without removing — the planner adding its result to what is already picked. */
  add(route: RouteFeature, options?: { partial?: boolean; covered?: PartialRouteGeometry }): void;
  remove(trackId: number): void;
  setPartial(trackId: number, partial: boolean): void;
  clear(): void;
}

const SelectionContext = createContext<SelectionValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }): ReactNode {
  const { regionId } = useRegion();
  const [selected, setSelected] = useState<SelectedRoute[]>([]);

  // Only a *change* of region clears, not the first render — which would be the
  // same thing here, but only by accident of the selection starting empty.
  const mountedRegion = useRef(regionId);
  useEffect(() => {
    if (mountedRegion.current === regionId) return;
    mountedRegion.current = regionId;
    setSelected([]);
  }, [regionId]);

  const isSelected = useCallback(
    (trackId: number) => selected.some((s) => s.route.trackId === trackId),
    [selected],
  );

  const toggle = useCallback((route: RouteFeature, covered?: PartialRouteGeometry | null) => {
    setSelected((current) =>
      current.some((s) => s.route.trackId === route.trackId)
        ? current.filter((s) => s.route.trackId !== route.trackId)
        : // A map tap is a new ride, whole until said otherwise — the same reason the
          // web app drops the tile's `partial` flag rather than inheriting it.
          [...current, { route, partial: covered != null, covered: covered ?? null }],
    );
  }, []);

  const add = useCallback(
    (route: RouteFeature, options?: { partial?: boolean; covered?: PartialRouteGeometry }) => {
      setSelected((current) => {
        const entry: SelectedRoute = {
          route,
          partial: options?.partial ?? options?.covered != null,
          covered: options?.covered ?? null,
        };
        const index = current.findIndex((s) => s.route.trackId === route.trackId);
        if (index === -1) return [...current, entry];
        // Already picked: the newer claim wins, so a planner result can narrow a
        // route that was tapped whole — or widen one, which is what re-adding means.
        const next = [...current];
        next[index] = entry;
        return next;
      });
    },
    [],
  );

  const remove = useCallback((trackId: number) => {
    setSelected((current) => current.filter((s) => s.route.trackId !== trackId));
  }, []);

  const setPartial = useCallback((trackId: number, partial: boolean) => {
    setSelected((current) =>
      current.map((s) =>
        s.route.trackId === trackId
          ? // Unticking claims the whole route, so the stretch goes with it — leaving
            // it would have the map highlight a stretch of a route logged whole.
            { ...s, partial, covered: partial ? s.covered : null }
          : s,
      ),
    );
  }, []);

  const clear = useCallback(() => setSelected([]), []);

  const value = useMemo(
    () => ({ selected, isSelected, toggle, add, remove, setPartial, clear }),
    [selected, isSelected, toggle, add, remove, setPartial, clear],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionValue {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("useSelection must be used inside a SelectionProvider");
  return value;
}
