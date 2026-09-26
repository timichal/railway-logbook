/**
 * When a route counts as ridden whole.
 *
 * A route logged with `partial = FALSE` is done outright. Beyond that, the
 * partial stretches a user has ridden are **unioned**: two rides over one route,
 * A→B and B→C, add up to the whole line, so the route counts as complete even
 * though neither ride was. Nothing merges the stored rows — each journey keeps
 * its own stretch (see "Partial rides" in CLAUDE.md); the union is computed on
 * read, here and in the SQL function of the same name.
 *
 * **This rule exists twice**: in `isRouteFullyRidden` below, for the
 * unauthenticated map's localStorage log, and as the SQL function
 * `user_fully_ridden_routes` in `database/init/02-vector-tiles.sql`, which both
 * the route tile (the colour on the map) and the progress queries go through.
 * Keep the two in step — the tolerances below are the numbers the SQL hard-codes.
 */

/**
 * How much untravelled track at the end of a route is noise rather than track
 * the journey missed.
 *
 * A station projects a few metres inside the route that starts there — a route's
 * endpoint is a hand-picked click point, not the platform centre — so a ride
 * from a terminus is recorded as starting a little past 0. Both uses of this
 * number follow from that: the Journey Planner won't call a leg partial when
 * less than this is left over, and a union of stretches reaching this close to
 * each end covers the route.
 *
 * Applied at each end, so it also closes a gap of up to twice this between two
 * stretches that meet at the same station. Two legs joined at one station
 * normally meet at the exact same fraction — the same point projected onto the
 * same geometry — but an OSM recalculation between the two rides moves them
 * slightly apart.
 */
export const UNTRAVELLED_NOISE_KM = 0.3;

/**
 * Cap on the tolerance as a fraction of the route, so it stays a tolerance.
 * Only bites on routes shorter than ~1.2km, where 0.3km is a large part of the
 * line: there, a stretch must still cover the middle half to reach both ends.
 */
const MAX_TOLERANCE_FRACTION = 0.25;

/** `UNTRAVELLED_NOISE_KM` as a fraction of a route's length (0 if unknown). */
export function coverageToleranceFraction(lengthKm: number | null | undefined): number {
  const length = Number(lengthKm);
  if (!Number.isFinite(length) || length <= 0) return 0;
  return Math.min(UNTRAVELLED_NOISE_KM / length, MAX_TOLERANCE_FRACTION);
}

/** A logged ride of one route, as much of it as this rule needs. */
export interface RiddenPart {
  partial: boolean;
  covered_start?: number | null;
  covered_end?: number | null;
}

/**
 * Whether `parts` — every ride the user logged of one route — cover all of it.
 *
 * Stretches of unknown extent (both fractions null: a route ticked partial by
 * hand) contribute nothing. They say a piece was ridden without saying which,
 * and a route can't be completed by a piece nobody can place.
 */
export function isRouteFullyRidden(
  parts: RiddenPart[],
  lengthKm: number | null | undefined,
): boolean {
  const tolerance = coverageToleranceFraction(lengthKm);
  const stretches: Array<[number, number]> = [];

  for (const part of parts) {
    if (!part.partial) return true;
    if (part.covered_start == null || part.covered_end == null) continue;
    stretches.push([
      Math.max(part.covered_start - tolerance, 0),
      Math.min(part.covered_end + tolerance, 1),
    ]);
  }

  // Sweep the widened stretches in order: each must start at or before where the
  // ones already seen reach, or nothing covers the gap between them.
  stretches.sort((a, b) => a[0] - b[0]);
  let reached = 0;
  for (const [start, end] of stretches) {
    if (start > reached) return false;
    reached = Math.max(reached, end);
  }
  return reached >= 1;
}
