/**
 * Journey reads and writes, taking the user id explicitly.
 *
 * Plain module, not "use server" — same reasoning as `progressQueries.ts`.
 * `journeyActions.ts` resolves the session and calls in; the mobile API's route
 * handlers resolve a bearer token and call the same functions
 * (MOBILE_APP_PLAN.md, Phase 1).
 *
 * A rejection meant for the caller is thrown as a `ValidationError` or a
 * `NotFoundError` (`errors.ts`), which the route handlers turn into a 400 or a
 * 404 and the web actions into `{ error }`; anything else propagates as the
 * exception it is.
 */

import type { PoolClient } from "pg";
import pool, { asMissingRow, withTransaction } from "./db";
import { NotFoundError, ValidationError } from "./errors";
import { buildCoveredStretches } from "./progressQueries";
import { routeBoundsByIds, routeEndsSql } from "./routeQueries";
import { isDateOnly } from "./shared/getUntimezonedDateStr";
import type { RegionId } from "./shared/regions";
import { knownStretches, sanitizeRange } from "./shared/routeCoverage";
import type {
  Journey,
  JourneyEdits,
  LoggedPart,
  LoggedRange,
  PartialRouteGeometry,
  RailwayRoute,
  RouteBounds,
} from "./shared/types";

/** Fraction range along a route's geometry — see user_logged_parts.covered_start. */
export type { LoggedRange };

/** Throws unless a journey's name and date can be written. */
function assertJourneyMeta(name: unknown, date: unknown): void {
  // Typed loosely because a server action's arguments are whatever the client sent
  if (typeof name !== "string" || name.trim() === "") {
    throw new ValidationError("Journey name is required");
  }
  if (typeof date !== "string" || !date) throw new ValidationError("Journey date is required");
  // Checked here rather than left to Postgres, which would reject a malformed or
  // non-existent day with an error that surfaces as an opaque 500
  if (!isDateOnly(date)) {
    throw new ValidationError("Journey date must be a real day, as YYYY-MM-DD");
  }
}

function assertAligned(trackIds: unknown, partialFlags: unknown): void {
  if (!Array.isArray(trackIds) || !Array.isArray(partialFlags)) {
    throw new ValidationError("Track IDs and partial flags must be lists");
  }
  if (trackIds.length !== partialFlags.length) {
    throw new ValidationError("Track IDs and partial flags length mismatch");
  }
}

/** `withTransaction`, with a foreign key violation rethrown as the `NotFoundError` it means. */
function inTransaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(body).catch((error: unknown) => {
    throw asMissingRow(error);
  });
}

/**
 * The VALUES rows for logging `trackIds` to a journey, one per track_id.
 *
 * Postgres rejects an ON CONFLICT DO UPDATE whose statement touches the same
 * conflicting row twice ("cannot affect row a second time"), so a repeated
 * trackId in one request would roll the whole insert back. Last entry wins —
 * what DO UPDATE would have done had they arrived as separate statements — and
 * a new journey dedupes the same way, so one request means the same thing
 * whether it creates the journey or adds to it. The web selection is already
 * deduped by track_id; the HTTP API is where a repeat can reach this.
 */
function loggedPartRows(
  userId: number,
  journeyId: number,
  trackIds: number[],
  partialFlags: boolean[],
  coveredRanges?: (LoggedRange | null)[],
): { placeholders: string; values: (number | boolean | null)[] } {
  const lastIndexByTrackId = new Map<number, number>();
  trackIds.forEach((trackId, index) => {
    lastIndexByTrackId.set(trackId, index);
  });

  const values: (number | boolean | null)[] = [];
  const valuePlaceholders: string[] = [];
  for (const [trackId, index] of lastIndexByTrackId) {
    const offset = values.length;
    const range = sanitizeRange(coveredRanges?.[index], partialFlags[index]);
    valuePlaceholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`,
    );
    values.push(
      userId,
      journeyId,
      trackId,
      partialFlags[index],
      range?.covered_start ?? null,
      range?.covered_end ?? null,
    );
  }

  return { placeholders: valuePlaceholders.join(", "), values };
}

/** A single journey with all its logged routes. */
export async function journeyForUser(
  userId: number,
  journeyId: number,
): Promise<{ journey: Journey; routes: RailwayRoute[] }> {
  // Both at once: the routes are read under the user too, so for a journey that
  // isn't theirs they come back empty, and the missing journey answers
  const journeyQuery = pool.query<Journey>(
    "SELECT * FROM user_journeys WHERE id = $1 AND user_id = $2",
    [journeyId, userId],
  );

  // Exclude the heavy geometry column; its two ends are enough to chain the routes
  const routesQuery = pool.query<RailwayRoute & LoggedPart>(
    `SELECT
      rr.track_id, rr.name, rr.from_station, rr.to_station,
      rr.description, rr.usage_type, rr.usage_tags, rr.link, rr.link_name, rr.line_class,
      rr.length_km, rr.start_country, rr.end_country,
      rr.is_valid, ${routeEndsSql("rr")} AS ends,
      ulp.partial, ulp.covered_start, ulp.covered_end
    FROM user_logged_parts ulp
    JOIN railway_routes rr ON ulp.track_id = rr.track_id
    WHERE ulp.journey_id = $1 AND ulp.user_id = $2
    -- In the order they were logged: a journey's are all inserted at once, so
    -- they share created_at, but the id follows the selection, which is roughly
    -- the order they were ridden in (journeyChains reads a chain's way from it)
    ORDER BY ulp.id`,
    [journeyId, userId],
  );

  const [journeyResult, routesResult] = await Promise.all([journeyQuery, routesQuery]);
  const journey = journeyResult.rows[0];
  if (!journey) throw new NotFoundError("Journey not found");

  return { journey, routes: routesResult.rows };
}

/**
 * A journey as it is opened: with the bounds of its routes in `region`, which the map
 * fits to (see routeBoundsByIds) — returned with it, so the fit needs no request of
 * its own — and `partials`, the stretch ridden of each route logged in part where
 * it is known, which the highlight draws in place of the whole route. Both
 * transports open a journey through this.
 */
export async function journeyWithBoundsForUser(
  userId: number,
  journeyId: number,
  region: RegionId,
): Promise<{
  journey: Journey;
  routes: RailwayRoute[];
  bounds: RouteBounds | null;
  partials: PartialRouteGeometry[];
}> {
  const result = await journeyForUser(userId, journeyId);
  const [bounds, partials] = await Promise.all([
    routeBoundsByIds(
      result.routes.map((r) => r.track_id),
      region,
    ),
    buildCoveredStretches(knownStretches(result.routes)),
  ]);
  return { ...result, bounds, partials };
}

/** Create a new journey and log routes to it, in one transaction. */
export async function createJourneyForUser(
  userId: number,
  name: string,
  description: string | null,
  date: string, // YYYY-MM-DD
  trackIds: number[],
  partialFlags: boolean[],
  tripId?: number | null,
  /**
   * Stretch ridden per route, positionally aligned with trackIds; null where the
   * extent isn't known (see user_logged_parts.covered_start).
   */
  coveredRanges?: (LoggedRange | null)[],
): Promise<Journey> {
  assertJourneyMeta(name, date);
  assertAligned(trackIds, partialFlags);

  return inTransaction(async (client) => {
    // The trip id arrives from the client: one that isn't the user's fails the
    // composite FK (trip_id, user_id), which inTransaction answers as "Trip not found"
    const journeyResult = await client.query<Journey>(
      `INSERT INTO user_journeys (user_id, name, description, date, trip_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, name.trim(), description, date, tripId || null],
    );
    const journey = journeyResult.rows[0];

    if (trackIds.length > 0) {
      const rows = loggedPartRows(userId, journey.id, trackIds, partialFlags, coveredRanges);
      await client.query(
        `INSERT INTO user_logged_parts (user_id, journey_id, track_id, partial, covered_start, covered_end)
         VALUES ${rows.placeholders}`,
        rows.values,
      );
    }

    return journey;
  });
}

/** Update journey metadata (name, description, date). */
export async function updateJourneyForUser(
  userId: number,
  journeyId: number,
  name: string,
  description: string | null,
  date: string,
): Promise<Journey> {
  assertJourneyMeta(name, date);

  const result = await pool.query<Journey>(
    `UPDATE user_journeys
     SET name = $1, description = $2, date = $3
     WHERE id = $4 AND user_id = $5
     RETURNING *`,
    [name.trim(), description, date, journeyId, userId],
  );
  if (result.rows.length === 0) throw new NotFoundError("Journey not found");
  return result.rows[0];
}

/** Delete a journey and all its logged parts. */
export async function deleteJourneyForUser(userId: number, journeyId: number): Promise<void> {
  const result = await pool.query("DELETE FROM user_journeys WHERE id = $1 AND user_id = $2", [
    journeyId,
    userId,
  ]);
  if (result.rowCount === 0) throw new NotFoundError("Journey not found");
}

/** Add routes to an existing journey. */
export async function addRoutesToJourneyForUser(
  userId: number,
  journeyId: number,
  trackIds: number[],
  partialFlags: boolean[],
  /** Stretch ridden per route, positionally aligned with trackIds (see createJourney). */
  coveredRanges?: (LoggedRange | null)[],
): Promise<void> {
  assertAligned(trackIds, partialFlags);

  // Not left to the composite FK: where someone else's journey already logs one
  // of these routes, the insert conflicts and DO UPDATE rewrites *their* row, and
  // an update that leaves journey_id and user_id alone is never FK-checked
  const journeyCheck = await pool.query(
    "SELECT id FROM user_journeys WHERE id = $1 AND user_id = $2",
    [journeyId, userId],
  );
  if (journeyCheck.rows.length === 0) throw new NotFoundError("Journey not found");
  if (trackIds.length === 0) return;

  // One statement, so it is atomic without a transaction of its own
  const rows = loggedPartRows(userId, journeyId, trackIds, partialFlags, coveredRanges);
  await pool
    .query(
      `INSERT INTO user_logged_parts (user_id, journey_id, track_id, partial, covered_start, covered_end)
       VALUES ${rows.placeholders}
       ON CONFLICT (journey_id, track_id) DO UPDATE SET
         partial = EXCLUDED.partial,
         covered_start = EXCLUDED.covered_start,
         covered_end = EXCLUDED.covered_end`,
      rows.values,
    )
    .catch((error: unknown) => {
      throw asMissingRow(error);
    });
}

/** Remove a single route from a journey. */
export async function removeRouteFromJourneyForUser(
  userId: number,
  journeyId: number,
  trackId: number,
): Promise<void> {
  const result = await pool.query(
    "DELETE FROM user_logged_parts WHERE journey_id = $1 AND track_id = $2 AND user_id = $3",
    [journeyId, trackId, userId],
  );
  if (result.rowCount === 0) throw new NotFoundError("Route not found in journey");
}

/**
 * Toggle partial flag for a logged part.
 *
 * Clearing `partial` clears the stretch with it, the same rule `sanitizeRange`
 * applies on every other write path: a route logged whole covers all of it, so a
 * range left behind would claim the whole route while still carrying fractions —
 * a state the rest of the code assumes cannot exist.
 */
export async function updateLoggedPartPartialForUser(
  userId: number,
  journeyId: number,
  trackId: number,
  partial: boolean,
): Promise<void> {
  const result = await pool.query(
    `UPDATE user_logged_parts
     SET partial = $1,
         covered_start = CASE WHEN $1 THEN covered_start ELSE NULL END,
         covered_end = CASE WHEN $1 THEN covered_end ELSE NULL END
     WHERE journey_id = $2 AND track_id = $3 AND user_id = $4`,
    [partial, journeyId, trackId, userId],
  );
  if (result.rowCount === 0) throw new NotFoundError("Route not found in journey");
}

/**
 * Save an edited journey — metadata, trip, logged routes and their partial flags —
 * in one transaction.
 *
 * The edit card used to send these as five separate calls and stop at the first
 * failure, leaving the journey half-saved and the card holding a snapshot that
 * no longer matched it, so retrying re-sent changes that had already landed. All
 * or nothing, a failed save leaves the journey exactly as the card loaded it.
 *
 * An upserted route is written as the edit has it, stretch included: the Route
 * Logger edits a journey as a whole selection, and a route re-picked through the
 * Journey Planner arrives with the stretch it measured. One sent without a stretch
 * has none, which is what unticking partial or ticking it by hand means.
 */
export async function saveJourneyEditsForUser(
  userId: number,
  journeyId: number,
  edits: JourneyEdits,
): Promise<void> {
  // Each only where it is sent: one left out keeps what the journey holds
  if (edits?.name !== undefined && (typeof edits.name !== "string" || edits.name.trim() === "")) {
    throw new ValidationError("Journey name is required");
  }
  if (edits?.date !== undefined && (typeof edits.date !== "string" || !isDateOnly(edits.date))) {
    throw new ValidationError("Journey date must be a real day, as YYYY-MM-DD");
  }
  const validRoutes =
    Array.isArray(edits.upsert) &&
    Array.isArray(edits.remove) &&
    edits.upsert.every(
      (u) =>
        Number.isInteger(u?.trackId) &&
        typeof u.partial === "boolean" &&
        (u.range == null || typeof u.range === "object"),
    ) &&
    edits.remove.every((trackId) => Number.isInteger(trackId));
  if (!validRoutes) throw new ValidationError("Malformed route changes");
  if (
    edits.description !== undefined &&
    edits.description !== null &&
    typeof edits.description !== "string"
  ) {
    throw new ValidationError("Journey description must be text");
  }

  await inTransaction(async (client) => {
    // First, so the journey row is locked against a concurrent delete for the
    // rest of the transaction; a journey that isn't the caller's stops here, and a
    // trip that isn't fails the composite FK (trip_id, user_id) as "Trip not found".
    // It runs when no field changed too, for the lock and the check.
    const updated = await client.query(
      `UPDATE user_journeys
       SET name = COALESCE($1, name),
           description = CASE WHEN $2 THEN $3 ELSE description END,
           date = COALESCE($4::date, date),
           trip_id = CASE WHEN $5 THEN $6::int ELSE trip_id END
       WHERE id = $7 AND user_id = $8`,
      [
        edits.name?.trim() ?? null,
        edits.description !== undefined,
        edits.description ?? null,
        edits.date ?? null,
        edits.tripId !== undefined,
        edits.tripId ?? null,
        journeyId,
        userId,
      ],
    );
    if (updated.rowCount === 0) throw new NotFoundError("Journey not found");

    if (edits.remove.length > 0) {
      await client.query(
        "DELETE FROM user_logged_parts WHERE journey_id = $1 AND user_id = $2 AND track_id = ANY($3::int[])",
        [journeyId, userId, edits.remove],
      );
    }

    if (edits.upsert.length > 0) {
      const rows = loggedPartRows(
        userId,
        journeyId,
        edits.upsert.map((u) => u.trackId),
        edits.upsert.map((u) => u.partial),
        edits.upsert.map((u) => u.range ?? null),
      );
      await client.query(
        `INSERT INTO user_logged_parts (user_id, journey_id, track_id, partial, covered_start, covered_end)
         VALUES ${rows.placeholders}
         ON CONFLICT (journey_id, track_id) DO UPDATE SET
           partial = EXCLUDED.partial,
           covered_start = EXCLUDED.covered_start,
           covered_end = EXCLUDED.covered_end`,
        rows.values,
      );
    }
  });
}
