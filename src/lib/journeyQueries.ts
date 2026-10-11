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
import pool, { asMissingRow } from "./db";
import { NotFoundError, ValidationError } from "./errors";
import { isDateOnly } from "./shared/getUntimezonedDateStr";
import type { Journey, LoggedPart, RailwayRoute } from "./shared/types";

/** Fraction range along a route's geometry — see user_logged_parts.covered_start. */
export interface LoggedRange {
  covered_start: number;
  covered_end: number;
}

/**
 * A ridden stretch is only stored when it is a genuine, non-degenerate part of
 * the route, and only for a partial ride: a route logged whole covers all of it,
 * so a range would be redundant (and would draw a stray overlay).
 */
export function sanitizeRange(
  range: LoggedRange | null | undefined,
  partial: boolean,
): LoggedRange | null {
  if (!partial || !range) return null;
  const start = Number(range.covered_start);
  const end = Number(range.covered_end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end > 1 || start >= end) return null;
  return { covered_start: start, covered_end: end };
}

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

/**
 * Run `body` in a transaction on a connection of its own, rolling back on any
 * failure and rethrowing it — a foreign key violation as the `NotFoundError` it
 * means.
 */
async function inTransaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let brokenConnection: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await body(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // A failed ROLLBACK means the connection itself is gone: keep the original
    // error, and have the pool discard the client (see migrationActions)
    await client.query("ROLLBACK").catch((rollbackError: Error) => {
      brokenConnection = rollbackError;
    });
    throw asMissingRow(error);
  } finally {
    client.release(brokenConnection);
  }
}

/**
 * Throws unless `tripId` is one of the user's own trips: it arrives from the
 * client, and an unchecked one files the journey under someone else's trip. A
 * trip that exists but isn't theirs answers exactly like one that doesn't exist.
 * The composite FK on user_journeys (trip_id, user_id) enforces the same. FOR
 * KEY SHARE holds off a concurrent delete of the trip until COMMIT, which would
 * otherwise turn a passed check into an FK error on the write.
 */
async function assertOwnTrip(client: PoolClient, userId: number, tripId: number): Promise<void> {
  const tripCheck = await client.query(
    "SELECT 1 FROM user_trips WHERE id = $1 AND user_id = $2 FOR KEY SHARE",
    [tripId, userId],
  );
  if (tripCheck.rows.length === 0) throw new NotFoundError("Trip not found");
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
  const journeyResult = await pool.query<Journey>(
    "SELECT * FROM user_journeys WHERE id = $1 AND user_id = $2",
    [journeyId, userId],
  );
  const journey = journeyResult.rows[0];
  if (!journey) throw new NotFoundError("Journey not found");

  // Exclude the heavy geometry column
  const routesResult = await pool.query<RailwayRoute & LoggedPart>(
    `SELECT
      rr.track_id, rr.name, rr.from_station, rr.to_station,
      rr.description, rr.usage_type, rr.frequency, rr.link, rr.line_class,
      rr.length_km, rr.start_country, rr.end_country,
      rr.is_valid,
      ulp.partial, ulp.covered_start, ulp.covered_end
    FROM user_logged_parts ulp
    JOIN railway_routes rr ON ulp.track_id = rr.track_id
    WHERE ulp.journey_id = $1 AND ulp.user_id = $2
    ORDER BY ulp.created_at ASC`,
    [journeyId, userId],
  );

  return { journey, routes: routesResult.rows };
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
    if (tripId) await assertOwnTrip(client, userId, tripId);

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

/** An edit of a journey as a whole — see `saveJourneyEditsForUser`. */
export interface JourneyEdits {
  name: string;
  description: string | null;
  date: string;
  /** The trip to file it under (null for none), or undefined to leave it where it is. */
  tripId?: number | null;
  /** Routes to log, or whose partial flag changed, with the flag they now carry. */
  upsert: { trackId: number; partial: boolean }[];
  /** Routes to unlog. */
  remove: number[];
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
 * An upserted route keeps its stretch while it stays partial and loses it when it
 * doesn't — the rule `updateLoggedPartPartialForUser` applies. A newly logged one
 * has no stretch: only the Journey Planner knows one, and it logs through
 * `createJourneyForUser`.
 */
export async function saveJourneyEditsForUser(
  userId: number,
  journeyId: number,
  edits: JourneyEdits,
): Promise<void> {
  assertJourneyMeta(edits?.name, edits?.date);
  const validRoutes =
    Array.isArray(edits.upsert) &&
    Array.isArray(edits.remove) &&
    edits.upsert.every((u) => Number.isInteger(u?.trackId) && typeof u.partial === "boolean") &&
    edits.remove.every((trackId) => Number.isInteger(trackId));
  if (!validRoutes) throw new ValidationError("Malformed route changes");
  if (edits.description !== null && typeof edits.description !== "string") {
    throw new ValidationError("Journey description must be text");
  }

  await inTransaction(async (client) => {
    if (edits.tripId) await assertOwnTrip(client, userId, edits.tripId);

    // First, so the journey row is locked against a concurrent delete for the
    // rest of the transaction; a journey that isn't the caller's stops here
    const updated = await client.query(
      `UPDATE user_journeys
       SET name = $1, description = $2, date = $3,
           trip_id = CASE WHEN $4 THEN $5::int ELSE trip_id END
       WHERE id = $6 AND user_id = $7`,
      [
        edits.name.trim(),
        edits.description,
        edits.date,
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
      );
      await client.query(
        `INSERT INTO user_logged_parts (user_id, journey_id, track_id, partial, covered_start, covered_end)
         VALUES ${rows.placeholders}
         ON CONFLICT (journey_id, track_id) DO UPDATE SET
           partial = EXCLUDED.partial,
           covered_start = CASE WHEN EXCLUDED.partial THEN user_logged_parts.covered_start END,
           covered_end = CASE WHEN EXCLUDED.partial THEN user_logged_parts.covered_end END`,
        rows.values,
      );
    }
  });
}
