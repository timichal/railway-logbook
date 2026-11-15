/**
 * What the user map knows of its owner's rides: which routes read as ridden, and how.
 *
 * The route tile is Martin's and the same for everyone (`railway_routes_tile`), so
 * it carries no rides. Both apps fetch them once as a list (`routeRidesForUser`,
 * through `/api/me/rides`, `/api/shared/<token>/rides` and `/api/v1/rides`; for an
 * anonymous visitor, worked out from their localStorage log) and lay them over the
 * tile by feature id: the colour and the draw order (`userRouteStyling.ts`), and
 * which closed routes stay on the map (`closedRoutesFilter`).
 *
 * By id in the style rather than as feature state. The draw order (ridden lines over
 * unridden ones) needs the ids in the style anyway: `line-sort-key` is a layout
 * property, which feature state can't reach. So it is one mechanism for both apps,
 * built here as plain expressions and tested in `tests/routeRides.test.ts`, where
 * feature state would be an imperative call per route on each renderer (an async
 * bridge call per route on native, re-made whenever the source remounts). A `match`
 * on `["id"]` is a hash lookup: a millisecond or two over the nine thousand routes of
 * a z5 view, however many ids it lists (measured 2026-11-15). Changing it re-lays out
 * the loaded tiles from memory, which happens on a login, a logged ride and a region
 * switch, each of which refetched every route tile before.
 */

/** One route the map's owner has ridden. */
export interface RouteRide {
  track_id: number;
  /**
   * Ridden whole: logged with `partial = false` in some journey, or partial
   * stretches adding up to all of it (`user_fully_ridden_routes`,
   * `isRouteFullyRidden`). Otherwise it reads as ridden in part.
   */
  whole: boolean;
  /** `railway_routes.closed`: kept on the map though "All closed lines" is off. */
  closed: boolean;
  /**
   * The most recent journey over it (by date, then the latest logged), for the
   * popup's "Most recent" row: both or neither. Neither for an anonymous visitor.
   */
  date: string | null;
  journey_name: string | null;
}

/** The rides, indexed the ways the map reads them. Ids are sorted ascending. */
export interface RouteRides {
  /** Every ridden route, for a popup or a tap. */
  byId: ReadonlyMap<number, RouteRide>;
  /** Every ridden route's id: the draw order's (`getUserRouteSortKeyExpression`). */
  ridden: readonly number[];
  whole: readonly number[];
  /** Ridden, but not the whole of it. */
  partial: readonly number[];
  /** The closed routes among them, which `closedRoutesFilter` lets through. */
  closed: readonly number[];
}

export const NO_RIDES: RouteRides = {
  byId: new Map(),
  ridden: [],
  whole: [],
  partial: [],
  closed: [],
};

const ascending = (a: number, b: number) => a - b;

/**
 * The rides, indexed. A track id listed twice keeps its last entry: a `match` may
 * not name one label in two branches.
 */
export function indexRides(rides: readonly RouteRide[]): RouteRides {
  const byId = new Map<number, RouteRide>();
  for (const ride of rides) byId.set(ride.track_id, ride);

  const whole: number[] = [];
  const partial: number[] = [];
  const closed: number[] = [];
  for (const [trackId, ride] of byId) {
    (ride.whole ? whole : partial).push(trackId);
    if (ride.closed) closed.push(trackId);
  }
  return {
    byId,
    ridden: [...byId.keys()].sort(ascending),
    whole: whole.sort(ascending),
    partial: partial.sort(ascending),
    closed: closed.sort(ascending),
  };
}

/**
 * An anonymous visitor's rides before their statuses load, or if they can't: no
 * colours (whether a route was ridden whole needs the route list), but every
 * logged route let through the closed filter. Which of them are closed is in the
 * route list too, so all of them are, and a ride the visitor logged never
 * disappears from their map for want of it.
 */
export function provisionalRides(loggedTrackIds: Iterable<number>): RouteRides {
  return { ...NO_RIDES, closed: [...new Set(loggedTrackIds)].sort(ascending) };
}

/**
 * Earlier rides kept after a failed refresh, with the provisional ones' routes let
 * through the closed filter too: a route logged since (perhaps a closed one) has
 * no colour until the rides load, but stays on the map. No earlier rides: the
 * provisional ones alone.
 */
export function keepWithProvisional(
  earlier: RouteRides | null,
  provisional: RouteRides,
): RouteRides {
  if (earlier === null) return provisional;
  const closed = [...new Set([...earlier.closed, ...provisional.closed])].sort(ascending);
  return sameIds(closed, earlier.closed) ? earlier : { ...earlier, closed };
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * Whether two answers say the same thing, so a refetch that changed nothing (a
 * return to the page or the app) keeps the rides it had: a new object would
 * restyle every route layer, and on native send every id list across the bridge.
 */
export function sameRides(a: RouteRides | null, b: RouteRides | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (!sameIds(a.ridden, b.ridden) || !sameIds(a.whole, b.whole) || !sameIds(a.closed, b.closed)) {
    return false;
  }
  for (const [trackId, ride] of a.byId) {
    const other = b.byId.get(trackId);
    if (other?.date !== ride.date || other.journey_name !== ride.journey_name) return false;
  }
  return true;
}

/**
 * How long a failed read of the rides waits before the next try: soon, then less
 * and less often, then every five minutes for as long as the map is open. A map
 * whose owner is on the server draws no routes until they come, so it never gives
 * up, and a shared map has nothing else that would ask again.
 */
export function ridesRetryDelayMs(attempt: number): number {
  const delays = [5_000, 15_000, 60_000];
  return delays[attempt] ?? 300_000;
}
