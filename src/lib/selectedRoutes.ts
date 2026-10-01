import type { SelectedRoute } from "@/lib/shared/types";

/** The new-journey form in the Route Logger, which the mobile sheet's summary bar scrolls to. */
export const NEW_JOURNEY_FORM_ID = "new-journey-form";

/** The stations a Journey Planner search ran between, by name — what a journey is usually called. */
export interface PlannedStops {
  from: string;
  via: string[];
  to: string;
}

/** A plan added to the selection, with the routes it actually added. */
export interface PlannedLeg {
  stops: PlannedStops;
  trackIds: number[];
}

/**
 * How much of a selected route the journey will log: the stretch the Journey Planner
 * measured while the route is still ticked partial, otherwise the whole line — a
 * route ticked partial by hand has no known extent, and unticking claims it whole.
 */
export function loggedLengthKm(route: SelectedRoute): number {
  return route.partial && route.travelled_length_km != null
    ? route.travelled_length_km
    : route.length_km;
}

/** The selection's total, as the journey will log it. */
export function selectionLengthKm(routes: SelectedRoute[]): number {
  return routes.reduce((sum, route) => sum + loggedLengthKm(route), 0);
}

/** "A to B via C" — the shape of the name field's placeholder. */
function nameFromStops(stops: string[]): string | null {
  // Consecutive repeats are one stop: where one planned leg ends and the next begins
  const seq = stops.filter((name, i) => name && name !== stops[i - 1]);
  if (seq.length < 2) return null;
  const from = seq[0];
  const to = seq[seq.length - 1];
  const via = seq.slice(1, -1);
  const base = from === to ? `${from} round trip` : `${from} to ${to}`;
  return via.length > 0 ? `${base} via ${via.join(", ")}` : base;
}

/**
 * The two ends of the selection, when its routes form one chain: the station names
 * that end an odd number of routes. The end on the first route picked goes first,
 * since that is usually where the clicking started. A loop or a branching selection
 * has no two ends.
 */
function selectionEnds(routes: SelectedRoute[]): string[] | null {
  if (routes.length === 0) return null;
  const counts = new Map<string, number>();
  for (const route of routes) {
    for (const name of [route.from_station, route.to_station]) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const ends = [...counts].filter(([, count]) => count % 2 === 1).map(([name]) => name);
  if (ends.length !== 2) return null;
  const first = routes[0];
  const onFirst = (name: string) => name === first.from_station || name === first.to_station;
  return !onFirst(ends[0]) && onFirst(ends[1]) ? [ends[1], ends[0]] : ends;
}

/**
 * A name to offer for the journey. The planner's stations are the better source —
 * the real stops, where the selection only knows the routes' endpoints, which may lie
 * past where the train was boarded — so a plan counts while any route it added is
 * still selected. Otherwise, the selection's own two ends.
 */
export function suggestJourneyName(legs: PlannedLeg[], routes: SelectedRoute[]): string | null {
  const selected = new Set(routes.map((route) => route.track_id));
  const live = legs.filter((leg) => leg.trackIds.some((id) => selected.has(id)));
  const planned = nameFromStops(live.flatMap(({ stops }) => [stops.from, ...stops.via, stops.to]));
  if (planned) return planned;
  const ends = selectionEnds(routes);
  return ends ? nameFromStops(ends) : null;
}
