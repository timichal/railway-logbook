/**
 * Editing a saved journey in the Route Logger.
 *
 * A journey is edited as what it was logged as: a selection of routes, built on
 * the map or with the Journey Planner, and the name, date, description and trip
 * beside it. Edit in My Trips puts the journey into the Route Logger, which then
 * shows it in place of the new journey being put together there; that one is
 * left as it was, and comes back once the edit is saved or cancelled.
 *
 * The edit is a draft in the edit guard (`editGuard.tsx`) under the journey's
 * key, routes included, so it outlives everything the Route Logger and My Trips
 * do meanwhile — a tab or region switch, the layout swap, another journey taken
 * up for editing — and is asked about before the page or the account goes.
 * Which draft the Route Logger is showing is the map's state (`RailwayMap`).
 */

import type {
  JourneyEdits,
  PartialRouteGeometry,
  RailwayRoute,
  SelectedRoute,
} from "./shared/types";
import { journeyEditKey, useDraft, useDraftSelect, useDraftUpdate } from "./ui/editGuard";

/** A journey as the edit sees it: its fields and its routes as a selection. */
export interface JourneySnapshot {
  name: string;
  date: string;
  description: string;
  tripId: number | null;
  routes: SelectedRoute[];
}

/**
 * The journey as it was when Edit was pressed, which Save diffs against, and the
 * edit as it stands.
 */
export interface JourneyEditDraft {
  base: JourneySnapshot;
  edit: JourneySnapshot;
}

/**
 * A loaded journey's routes as a Route Logger selection: a partial ride of known
 * extent keeps its stretch, drawn from `partials` where the load cut it to
 * geometry, so that saving it untouched writes it back as it was.
 */
export function selectionFromJourney(
  routes: RailwayRoute[],
  partials: PartialRouteGeometry[],
): SelectedRoute[] {
  return routes.map((route) => {
    const length = Number(route.length_km ?? 0) || 0;
    const { covered_start: start, covered_end: end } = route;
    const known = route.partial && start != null && end != null;
    const covered = known
      ? (partials.find(
          (p) =>
            p.track_id === route.track_id && p.covered_start === start && p.covered_end === end,
        ) ?? {
          // Outside what the load cut (another region's route): nothing to draw,
          // but the stretch is still the ride's
          track_id: route.track_id,
          covered_start: start,
          covered_end: end,
          coordinates: [],
          usage_type: route.usage_type,
        })
      : null;
    return {
      track_id: route.track_id,
      name: route.name,
      from_station: route.from_station,
      to_station: route.to_station,
      description: route.description ?? "",
      usage_types: "",
      link: route.link ?? null,
      date: null,
      journey_name: null,
      partial: route.partial ?? false,
      length_km: length,
      covered,
      travelled_length_km: covered ? (covered.covered_end - covered.covered_start) * length : null,
    };
  });
}

/** The stretch a selected route will be logged with: only a partial ride's, where known. */
function rangeOf(route: SelectedRoute) {
  return route.partial && route.covered
    ? { covered_start: route.covered.covered_start, covered_end: route.covered.covered_end }
    : null;
}

/** The routes Save sends: added or changed (partial flag or stretch), and removed. */
export function journeyRouteChanges(
  base: SelectedRoute[],
  edit: SelectedRoute[],
): Pick<JourneyEdits, "upsert" | "remove"> {
  const before = new Map(base.map((route) => [route.track_id, route]));
  const kept = new Set(edit.map((route) => route.track_id));
  const upsert = edit.flatMap((route) => {
    const was = before.get(route.track_id);
    const range = rangeOf(route);
    const wasRange = was && rangeOf(was);
    const changed =
      !was ||
      (was.partial ?? false) !== (route.partial ?? false) ||
      wasRange?.covered_start !== range?.covered_start ||
      wasRange?.covered_end !== range?.covered_end;
    return changed ? [{ trackId: route.track_id, partial: route.partial ?? false, range }] : [];
  });
  const remove = base.filter((route) => !kept.has(route.track_id)).map((r) => r.track_id);
  return { upsert, remove };
}

/**
 * What Save sends: the routes that changed, and of the fields only those the edit
 * changed. One left alone keeps whatever the journey holds when it lands, which
 * may have changed elsewhere since the edit began.
 */
export function journeyEditsToSave({ base, edit }: JourneyEditDraft): JourneyEdits {
  const name = edit.name.trim();
  const description = edit.description.trim();
  return {
    name: name !== base.name.trim() ? name : undefined,
    description: description !== base.description.trim() ? description || null : undefined,
    date: edit.date !== base.date ? edit.date : undefined,
    tripId: edit.tripId !== base.tripId ? edit.tripId : undefined,
    ...journeyRouteChanges(base.routes, edit.routes),
  };
}

/** Whether Save would change anything: the edit guard asks only about those. */
export function journeyEditChanged({ base, edit }: JourneyEditDraft): boolean {
  if (
    edit.name.trim() !== base.name.trim() ||
    edit.date !== base.date ||
    edit.description.trim() !== base.description.trim() ||
    edit.tripId !== base.tripId
  ) {
    return true;
  }
  const { upsert, remove } = journeyRouteChanges(base.routes, edit.routes);
  return upsert.length > 0 || remove.length > 0;
}

const draftLabel = (draft: JourneyEditDraft) => `"${draft.base.name}"`;

/**
 * The draft of the journey `id`, or of none while `id` is null: for the form,
 * which re-renders as it is typed into.
 */
export function useJourneyEditDraft(id: number | string | null) {
  // A key nothing writes while there is no journey: the setter goes unused then
  return useDraft<JourneyEditDraft>(journeyEditKey(id ?? ""), draftLabel, journeyEditChanged);
}

/**
 * What the map and the Route Logger around the form need of the draft of `id`:
 * its routes (undefined while there is no draft) and the journey's name. They
 * don't re-render as its fields are typed into. `update` changes the draft as it
 * stands at the call, or drops it (null).
 */
export function useJourneyEditRoutes(id: number | string | null) {
  const key = journeyEditKey(id ?? "");
  const routes = useDraftSelect<JourneyEditDraft, SelectedRoute[]>(key, (d) => d.edit.routes);
  const name = useDraftSelect<JourneyEditDraft, string>(key, (d) => d.base.name);
  const update = useDraftUpdate<JourneyEditDraft>(key, draftLabel, journeyEditChanged);
  return { routes: id === null ? undefined : routes, name: name ?? null, update };
}
