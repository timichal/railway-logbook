/**
 * The Journey Planner's form and its answer, held above the navigator.
 *
 * The planner is a modal, and a modal's own state goes with it: closing it to look at
 * the gold path on the map used to throw away the legs and the form, so adding that
 * path to the selection meant planning it twice. Here they outlive the screen, as the
 * web planner's do by living in a sidebar tab that is hidden rather than unmounted.
 *
 * **The search runs here too**, not in the screen. A search still running when the
 * modal is closed lands its answer here rather than in a component that is gone, and
 * "only the latest search may write" is one counter rather than one per mount.
 *
 * **The gold line belongs to the answer.** Whatever drops the answer — an edit to the
 * form, the non-JR switch, Clear, adding the routes to the selection — takes the
 * planner's highlight off the map with it, but only while the map is still showing
 * the planner's: a journey the logbook has pointed the map at since is not the
 * planner's to clear.
 *
 * **A found path is flown to**, with the box the planner sends back with it — when
 * the answer arrives, and again whenever the planner is reopened over it, as the
 * logbook's "Showing on the map" flies back. The map makes the move once it is in
 * view, so with this modal over it, on closing.
 *
 * Cleared on a region switch, as the web app's planner is: its stations and its
 * answer are the other region's. And when the session ends: the provider sits above
 * the auth guard, and the next account must not open the last one's plan.
 */
import { hasOrdinaryNonRegular } from "@shared/regions";
import type { PlannerRoute, RouteBounds, Station } from "@shared/types";
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
import * as api from "@/api/endpoints";
import { useOnSessionEnd } from "@/auth/useOnSessionEnd";
import { useHighlight } from "@/logbook/HighlightContext";
import { useRegion } from "@/region/RegionContext";

/** Whose highlight on the map is the planner's (`Highlight.ownerKey`). */
const PLANNER_OWNER = "planner";

export interface PlannerForm {
  from: Station | null;
  to: Station | null;
  /**
   * A slot is created empty and filled afterwards, so the list carries nulls — the
   * same positional shape the web app's via rows have.
   */
  vias: (Station | null)[];
  /** Offered only where the region counts lines beyond Regular; on by default. */
  includeSpecial: boolean;
}

export interface PlannerResult {
  routes: PlannerRoute[];
  totalDistance: number;
  bounds: RouteBounds | null;
}

interface PlannerValue {
  form: PlannerForm;
  result: PlannerResult | null;
  error: string | null;
  searching: boolean;
  /** Changes the form. The answer was for the old one, so it goes. */
  editForm(update: (form: PlannerForm) => PlannerForm): void;
  find(): Promise<void>;
  /** Puts the answer's gold line back on the map and flies to it — the screen asks on opening. */
  showOnMap(): void;
  /** An empty form and no answer: Clear, a spent plan, a region switch. */
  reset(): void;
}

const EMPTY_FORM: PlannerForm = { from: null, to: null, vias: [], includeSpecial: true };

const PlannerContext = createContext<PlannerValue | null>(null);

/** A station id is `string | number` off the API, and may be negative (see `API.md`). */
function stationId(station: Station): number {
  return typeof station.id === "string" ? Number.parseInt(station.id, 10) : station.id;
}

export function PlannerProvider({ children }: { children: ReactNode }): ReactNode {
  const { regionId } = useRegion();
  const { ownerKey, highlight, refit, clear: clearHighlight } = useHighlight();

  const [form, setForm] = useState<PlannerForm>(EMPTY_FORM);
  const [result, setResult] = useState<PlannerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  // Only the latest search may write: anything that drops the answer also drops a
  // search still running, whose answer would be for a form that no longer exists
  const searchRef = useRef(0);

  // Read from the callbacks, so they stay stable while knowing what the map shows
  const mapShowsPlan = useRef(false);
  mapShowsPlan.current = ownerKey === PLANNER_OWNER;

  const dropResult = useCallback((): void => {
    searchRef.current++;
    setSearching(false);
    setResult(null);
    setError(null);
    if (mapShowsPlan.current) clearHighlight();
  }, [clearHighlight]);

  const editForm = useCallback<PlannerValue["editForm"]>(
    (update) => {
      setForm(update);
      dropResult();
    },
    [dropResult],
  );

  const reset = useCallback((): void => {
    setForm(EMPTY_FORM);
    dropResult();
  }, [dropResult]);

  // Only a *change* of region resets, not the first render. The highlight provider
  // clears the map on the same switch.
  const mountedRegion = useRef(regionId);
  useEffect(() => {
    if (mountedRegion.current === regionId) return;
    mountedRegion.current = regionId;
    reset();
  }, [regionId, reset]);

  useOnSessionEnd(reset);

  const highlightResult = useCallback(
    ({ routes, bounds }: PlannerResult): void => {
      highlight({
        trackIds: routes.map((r) => r.track_id),
        kind: "planner",
        // A terminal route joined between its endpoints is highlighted along the
        // stretch travelled only, so the gold line stops at the station.
        partials: routes.flatMap((r) => (r.partial ? [r.partial] : [])),
        ownerKey: PLANNER_OWNER,
        bounds,
      });
    },
    [highlight],
  );

  const find = useCallback(async (): Promise<void> => {
    const { from, to, vias, includeSpecial } = form;
    if (!from || !to) {
      setError("Pick both a from and a to station.");
      return;
    }
    if (vias.some((s) => s === null)) {
      setError("Fill in every via station, or remove the empty ones.");
      return;
    }

    dropResult();
    const request = searchRef.current;
    setSearching(true);
    try {
      const answer = await api.plan({
        fromStationId: stationId(from),
        toStationId: stationId(to),
        viaStationIds: vias.flatMap((s) => (s ? [stationId(s)] : [])),
        includeSpecial: hasOrdinaryNonRegular(regionId) && includeSpecial,
      });
      if (request !== searchRef.current) return;

      // "No path found" is a 200 with an `error`, not a failure — see `API.md`
      if (answer.error) {
        setError(answer.error);
        return;
      }

      const found = {
        routes: answer.routes,
        totalDistance: answer.totalDistance,
        bounds: answer.bounds,
      };
      setResult(found);
      highlightResult(found);
    } catch (caught) {
      if (request !== searchRef.current) return;
      setError(caught instanceof Error ? caught.message : "Could not plan that journey.");
    } finally {
      if (request === searchRef.current) setSearching(false);
    }
  }, [form, regionId, dropResult, highlightResult]);

  const showOnMap = useCallback((): void => {
    if (!result) return;
    if (mapShowsPlan.current) refit();
    else highlightResult(result);
  }, [result, highlightResult, refit]);

  const value = useMemo(
    () => ({ form, result, error, searching, editForm, find, showOnMap, reset }),
    [form, result, error, searching, editForm, find, showOnMap, reset],
  );

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerValue {
  const value = useContext(PlannerContext);
  if (!value) throw new Error("usePlanner must be used inside a PlannerProvider");
  return value;
}
