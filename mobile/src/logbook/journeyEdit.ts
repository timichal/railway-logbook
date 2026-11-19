/**
 * Editing a saved journey, as the web's `journeyEdit.ts` does it: the journey is
 * taken up as what it was logged as, a selection of routes plus its fields
 * (`SelectionContext`'s edit draft), and Save sends only what changed.
 */
import type { PartialRouteGeometry } from "@shared/types";
import type * as api from "@/api/endpoints";
import { routeFeatureFromMetadata } from "@/map/mapFeatures";
import {
  type JourneyForm,
  type JourneySnapshot,
  journeyRouteChanges,
  rangeOf,
  type SelectedRoute,
} from "./SelectionContext";

/**
 * A loaded journey as an edit starts from it. A partial ride keeps its stretch,
 * drawn from `partials` where the load cut it to geometry, so that saving it
 * untouched writes it back as it was.
 */
export function snapshotFromJourney(loaded: api.LoadedJourney): JourneySnapshot {
  const { journey, routes, partials } = loaded;
  return {
    form: {
      name: journey.name,
      date: journey.date,
      description: journey.description ?? "",
      tripId: journey.trip_id,
    },
    routes: routes.map((route): SelectedRoute => {
      const { covered_start: start, covered_end: end } = route;
      const known = route.partial && start != null && end != null;
      const covered: PartialRouteGeometry | null = known
        ? (partials.find(
            (p) =>
              p.track_id === route.track_id && p.covered_start === start && p.covered_end === end,
          ) ?? {
            // A stretch the load cut to under two points, so dropped: nothing to
            // draw (the map draws the route whole), but the stretch is still the ride's
            track_id: route.track_id,
            covered_start: start,
            covered_end: end,
            coordinates: [],
            usage_type: route.usage_type,
          })
        : null;
      return {
        route: routeFeatureFromMetadata({ ...route, length_km: Number(route.length_km ?? 0) }),
        partial: route.partial,
        covered,
      };
    }),
  };
}

/** One selected route as the logging endpoints take it. */
export function loggedRouteInput(entry: SelectedRoute): api.LoggedRouteInput {
  return {
    trackId: entry.route.trackId,
    partial: entry.partial,
    covered: rangeOf(entry) ?? undefined,
  };
}

/**
 * What Save sends: the routes that changed, and of the fields only those the edit
 * changed. One left alone keeps whatever the journey holds when it lands, which may
 * have changed on the web since the edit began.
 */
export function journeyEditsToSave(
  base: JourneySnapshot,
  form: JourneyForm,
  routes: SelectedRoute[],
): api.JourneyEditInput {
  const name = form.name.trim();
  const description = form.description.trim();
  const { upsert, remove } = journeyRouteChanges(base.routes, routes);
  return {
    name: name !== base.form.name.trim() ? name : undefined,
    description: description !== base.form.description.trim() ? description || null : undefined,
    date: form.date !== base.form.date ? form.date : undefined,
    tripId: form.tripId !== base.form.tripId ? form.tripId : undefined,
    upsert: upsert.map(loggedRouteInput),
    remove,
  };
}
