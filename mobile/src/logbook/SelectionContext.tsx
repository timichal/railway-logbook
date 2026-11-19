/**
 * The Route Logger's selection and form: which routes are about to be logged as a
 * journey, under what name, date, description and trip — or, while a saved journey
 * is being edited, that journey's routes and fields.
 *
 * The web app keeps this in `MainLayout` and passes it down the sidebar; here it is
 * a context, because the two halves that need it are in different places on the
 * navigation tree — the map (which both adds to it and highlights it) and the
 * logging screen (which spends it). A tab bar between them rules out props.
 *
 * **Two drafts, one active.** The new journey being put together is one. Editing a
 * saved journey (`startEdit`, from its logbook card) puts that journey in front as
 * the other, as the web's Route Logger does (`journeyEdit.ts`): from then on the map
 * taps, the planner's "add" and the highlight all work on the journey's routes, and
 * the new journey's wait untouched until the edit is saved or dropped (`endEdit`).
 * `selected` and `form` are always the active draft's. One journey is edited at a
 * time.
 *
 * **The form outlives the logging screen.** It is a modal that is closed to go back
 * to the map and pick more, so what was typed stays until the journey is logged
 * (`resetNew`) or the edit ends — the web's `editGuard` drafts, minus the asking.
 *
 * A new selection is made *on a region's map*, so **switching region clears it**
 * and its trip (trips are listed per region), as the web app does. The alternative
 * is a journey logged in Europe carrying a route in Japan, which nothing downstream
 * would reject. A journey being edited keeps its routes: they are the journey's own.
 * **Signing out clears both**: the provider sits above the auth guard, so it would
 * otherwise be waiting for the next account (`useOnSessionEnd`).
 *
 * What is held per route is the tile feature itself plus the two logging decisions
 * (`partial` and, where it is known, the stretch). Keeping the whole feature means
 * the logging screen renders a route with the same `routeTitle`/`routeBadges` the
 * map sheet does, rather than a second, thinner description of the same thing.
 */
import { getUntimezonedDateStr } from "@shared/getUntimezonedDateStr";
import type { LoggedRange, PartialRouteGeometry } from "@shared/types";
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

/** The journey's own fields, as the logging screen edits them. */
export interface JourneyForm {
  name: string;
  /** `YYYY-MM-DD`, as typed: checked before it is sent. */
  date: string;
  description: string;
  tripId: number | null;
}

/** A saved journey as an edit starts from it, and as Save diffs against. */
export interface JourneySnapshot {
  form: JourneyForm;
  routes: SelectedRoute[];
}

interface Draft {
  form: JourneyForm;
  routes: SelectedRoute[];
}

interface NewDraft extends Draft {
  /**
   * Whether the date was chosen rather than defaulted. A defaulted one is "today",
   * moved on as the days pass (`freshenDate`): the draft can sit in memory for days.
   */
  dateChosen: boolean;
}

interface EditDraft extends Draft {
  journeyId: number;
  base: JourneySnapshot;
}

/** What is known of the edit under way, for the screens around it. */
export interface EditingJourney {
  journeyId: number;
  /** The name it had when the edit began: what the edit is called. */
  name: string;
  /** Whether Save would change anything. */
  changed: boolean;
  base: JourneySnapshot;
}

interface SelectionValue {
  selected: SelectedRoute[];
  form: JourneyForm;
  /** The saved journey being edited, or null while a new one is being put together. */
  editing: EditingJourney | null;
  /** Whether this route is in the selection — what the map sheet's button reads. */
  isSelected(trackId: number): boolean;
  /** Add it, or remove it if it is already there. Adds unticked: a tap is a whole ride. */
  toggle(route: RouteFeature, covered?: PartialRouteGeometry | null): void;
  /** Add without removing — the planner adding its result to what is already picked. */
  add(route: RouteFeature, options?: { partial?: boolean; covered?: PartialRouteGeometry }): void;
  remove(trackId: number): void;
  setPartial(trackId: number, partial: boolean): void;
  /** Empties the routes, leaving what was typed. */
  clear(): void;
  updateForm(patch: Partial<JourneyForm>): void;
  /** After a journey is logged: a fresh form and no routes. */
  resetNew(): void;
  /** A new journey's date that was never chosen becomes today's, as the form opens. */
  freshenDate(): void;
  /** A trip deleted: no draft may still be filed under it. */
  forgetTrip(tripId: number): void;
  /** Puts a saved journey in front, replacing any other edit. */
  startEdit(journeyId: number, snapshot: JourneySnapshot): void;
  /** Drops the edit, saved or not; the new journey comes back as it was. */
  endEdit(): void;
}

/** `YYYY-MM-DD`, `days` before today, in the phone's own timezone. */
export function dateOffsetFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return getUntimezonedDateStr(date);
}

function emptyDraft(): NewDraft {
  return {
    form: { name: "", date: dateOffsetFromToday(0), description: "", tripId: null },
    routes: [],
    dateChosen: false,
  };
}

/** The stretch a route will be logged with: only a partial ride's, where known. */
export function rangeOf(entry: SelectedRoute): LoggedRange | null {
  return entry.partial && entry.covered
    ? { covered_start: entry.covered.covered_start, covered_end: entry.covered.covered_end }
    : null;
}

/** The routes an edit's Save sends: added or changed (flag or stretch), and removed. */
export function journeyRouteChanges(
  base: SelectedRoute[],
  edit: SelectedRoute[],
): { upsert: SelectedRoute[]; remove: number[] } {
  const before = new Map(base.map((entry) => [entry.route.trackId, entry]));
  const kept = new Set(edit.map((entry) => entry.route.trackId));
  const upsert = edit.filter((entry) => {
    const was = before.get(entry.route.trackId);
    if (!was) return true;
    const range = rangeOf(entry);
    const wasRange = rangeOf(was);
    return (
      was.partial !== entry.partial ||
      wasRange?.covered_start !== range?.covered_start ||
      wasRange?.covered_end !== range?.covered_end
    );
  });
  const remove = base
    .filter((entry) => !kept.has(entry.route.trackId))
    .map((entry) => entry.route.trackId);
  return { upsert, remove };
}

function formChanged(base: JourneyForm, edit: JourneyForm): boolean {
  return (
    edit.name.trim() !== base.name.trim() ||
    edit.date !== base.date ||
    edit.description.trim() !== base.description.trim() ||
    edit.tripId !== base.tripId
  );
}

function editChanged(draft: EditDraft): boolean {
  if (formChanged(draft.base.form, draft.form)) return true;
  const { upsert, remove } = journeyRouteChanges(draft.base.routes, draft.routes);
  return upsert.length > 0 || remove.length > 0;
}

const SelectionContext = createContext<SelectionValue | null>(null);

export function SelectionProvider({ children }: { children: ReactNode }): ReactNode {
  const { regionId } = useRegion();
  const [newDraft, setNewDraft] = useState<NewDraft>(emptyDraft);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  // Read by the updaters, which are stable and so can't close over the state
  const editingRef = useRef(false);
  editingRef.current = editDraft !== null;

  /** Applies to whichever draft is in front. */
  const updateActive = useCallback((change: (draft: Draft) => Draft) => {
    if (editingRef.current) {
      setEditDraft((current) => (current ? { ...current, ...change(current) } : current));
    } else {
      setNewDraft((current) => {
        const next = change(current);
        return {
          ...current,
          ...next,
          dateChosen: current.dateChosen || next.form.date !== current.form.date,
        };
      });
    }
  }, []);

  const setRoutes = useCallback(
    (change: (routes: SelectedRoute[]) => SelectedRoute[]) =>
      updateActive((draft) => ({ ...draft, routes: change(draft.routes) })),
    [updateActive],
  );

  // Only a *change* of region clears, not the first render — which would be the
  // same thing here, but only by accident of the selection starting empty.
  const mountedRegion = useRef(regionId);
  useEffect(() => {
    if (mountedRegion.current === regionId) return;
    mountedRegion.current = regionId;
    setNewDraft((current) => ({ ...current, form: { ...current.form, tripId: null }, routes: [] }));
  }, [regionId]);

  useOnSessionEnd(() => {
    setNewDraft(emptyDraft());
    setEditDraft(null);
  });

  const active = editDraft ?? newDraft;
  const selected = active.routes;

  const isSelected = useCallback(
    (trackId: number) => selected.some((s) => s.route.trackId === trackId),
    [selected],
  );

  const toggle = useCallback(
    (route: RouteFeature, covered?: PartialRouteGeometry | null) =>
      setRoutes((current) =>
        current.some((s) => s.route.trackId === route.trackId)
          ? current.filter((s) => s.route.trackId !== route.trackId)
          : // A map tap is a new ride, whole until said otherwise — the same reason the
            // web app drops the tile's `partial` flag rather than inheriting it.
            [...current, { route, partial: covered != null, covered: covered ?? null }],
      ),
    [setRoutes],
  );

  const add = useCallback(
    (route: RouteFeature, options?: { partial?: boolean; covered?: PartialRouteGeometry }) =>
      setRoutes((current) => {
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
      }),
    [setRoutes],
  );

  const remove = useCallback(
    (trackId: number) => setRoutes((current) => current.filter((s) => s.route.trackId !== trackId)),
    [setRoutes],
  );

  const setPartial = useCallback(
    (trackId: number, partial: boolean) =>
      setRoutes((current) =>
        current.map((s) =>
          s.route.trackId === trackId
            ? // Unticking claims the whole route, so the stretch goes with it — leaving
              // it would have the map highlight a stretch of a route logged whole.
              { ...s, partial, covered: partial ? s.covered : null }
            : s,
        ),
      ),
    [setRoutes],
  );

  const clear = useCallback(() => setRoutes(() => []), [setRoutes]);

  const updateForm = useCallback(
    (patch: Partial<JourneyForm>) =>
      updateActive((draft) => ({ ...draft, form: { ...draft.form, ...patch } })),
    [updateActive],
  );

  const resetNew = useCallback(() => setNewDraft(emptyDraft()), []);

  const freshenDate = useCallback(() => {
    const today = dateOffsetFromToday(0);
    setNewDraft((current) =>
      current.dateChosen || current.form.date === today
        ? current
        : { ...current, form: { ...current.form, date: today } },
    );
  }, []);

  const forgetTrip = useCallback((tripId: number) => {
    const unfiled = (form: JourneyForm) =>
      form.tripId === tripId ? { ...form, tripId: null } : form;
    setNewDraft((current) => ({ ...current, form: unfiled(current.form) }));
    // The server unfiled the journey too, so the edit's base follows: an edit
    // left on the deleted trip would otherwise send it back, and fail
    setEditDraft((current) =>
      current
        ? {
            ...current,
            form: unfiled(current.form),
            base: { ...current.base, form: unfiled(current.base.form) },
          }
        : current,
    );
  }, []);

  const startEdit = useCallback((journeyId: number, snapshot: JourneySnapshot) => {
    setEditDraft({ journeyId, base: snapshot, form: snapshot.form, routes: snapshot.routes });
  }, []);

  const endEdit = useCallback(() => setEditDraft(null), []);

  const editing = useMemo<EditingJourney | null>(
    () =>
      editDraft
        ? {
            journeyId: editDraft.journeyId,
            name: editDraft.base.form.name,
            changed: editChanged(editDraft),
            base: editDraft.base,
          }
        : null,
    [editDraft],
  );

  const value = useMemo(
    () => ({
      selected,
      form: active.form,
      editing,
      isSelected,
      toggle,
      add,
      remove,
      setPartial,
      clear,
      updateForm,
      resetNew,
      freshenDate,
      forgetTrip,
      startEdit,
      endEdit,
    }),
    [
      selected,
      active.form,
      editing,
      isSelected,
      toggle,
      add,
      remove,
      setPartial,
      clear,
      updateForm,
      resetNew,
      freshenDate,
      forgetTrip,
      startEdit,
      endEdit,
    ],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionValue {
  const value = useContext(SelectionContext);
  if (!value) throw new Error("useSelection must be used inside a SelectionProvider");
  return value;
}
