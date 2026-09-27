"use server";

import { getUser } from "./authActions";
import pool from "./db";
import { sanitizeRange } from "./journeyQueries";

export interface MigrationResult {
  migrated: number;
  skipped: number;
}

export interface JourneyMigrationResult {
  journeysMigrated: number;
  journeysSkipped: number;
  partsMigrated: number;
  partsSkipped: number;
  /** Distinct routes left out because the admin has since deleted them. */
  missingRoutes: number;
}

/**
 * Migrates localStorage journeys to the database for a logged-in user
 * Creates journeys and their logged parts in the database
 *
 * All or nothing, in one transaction: the caller keeps the local copy when this
 * throws, and a retry then starts from the same state rather than from half an
 * import. Parts whose route the admin has deleted since they were logged are
 * skipped and counted — left in, their FK violation failed every retry at the
 * same point.
 */
export async function migrateLocalJourneys(
  localJourneys: { id: string; name: string; description: string | null; date: string }[],
  localParts: {
    journey_id: string;
    track_id: number;
    partial: boolean;
    // Ridden stretch, when the local journey captured one (see CoveredRange)
    covered_start?: number | null;
    covered_end?: number | null;
  }[],
): Promise<JourneyMigrationResult> {
  const user = await getUser();

  if (!user) {
    throw new Error("You must be logged in to migrate journeys");
  }

  const result: JourneyMigrationResult = {
    journeysMigrated: 0,
    journeysSkipped: 0,
    partsMigrated: 0,
    partsSkipped: 0,
    missingRoutes: 0,
  };

  // Map local journey IDs to database journey IDs
  const journeyIdMap = new Map<string, number>();
  const missingTrackIds = new Set<number>();

  const client = await pool.connect();
  let brokenConnection: Error | undefined;
  try {
    await client.query("BEGIN");

    for (const localJourney of localJourneys) {
      // A journey already on the account with the same name and date is taken
      // to be this one, merged into it on an earlier login. Each account journey
      // is matched at most once, whether it was there before or created a
      // moment ago: two local journeys of one name and date are two journeys
      // that day (an out-and-back), not one journey twice.
      const duplicateCheck = await client.query<{ id: number }>(
        `SELECT id FROM user_journeys
         WHERE user_id = $1
         AND name = $2
         AND date = $3
         AND id <> ALL($4::int[])
         ORDER BY id
         LIMIT 1`,
        [user.id, localJourney.name, localJourney.date, [...journeyIdMap.values()]],
      );

      if (duplicateCheck.rows.length > 0) {
        journeyIdMap.set(localJourney.id, duplicateCheck.rows[0].id);
        result.journeysSkipped++;
        continue;
      }

      const inserted = await client.query<{ id: number }>(
        `INSERT INTO user_journeys (user_id, name, description, date)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [user.id, localJourney.name, localJourney.description, localJourney.date],
      );
      const newJourneyId = inserted.rows[0].id;
      journeyIdMap.set(localJourney.id, newJourneyId);
      result.journeysMigrated++;
    }

    const existingRoutes = await client.query<{ track_id: number }>(
      "SELECT track_id FROM railway_routes WHERE track_id = ANY($1::int[])",
      [[...new Set(localParts.map((part) => part.track_id))]],
    );
    const existingTrackIds = new Set(existingRoutes.rows.map((row) => row.track_id));

    for (const localPart of localParts) {
      const dbJourneyId = journeyIdMap.get(localPart.journey_id);
      if (!dbJourneyId) {
        // Its journey wasn't in the export
        result.partsSkipped++;
        continue;
      }

      if (!existingTrackIds.has(localPart.track_id)) {
        missingTrackIds.add(localPart.track_id);
        continue;
      }

      const partial = Boolean(localPart.partial);
      const range = sanitizeRange(
        localPart.covered_start != null && localPart.covered_end != null
          ? { covered_start: localPart.covered_start, covered_end: localPart.covered_end }
          : null,
        partial,
      );

      // One row per (journey, route): a route already logged on the journey
      // (merged into on an earlier login) is skipped
      const inserted = await client.query(
        `INSERT INTO user_logged_parts (user_id, journey_id, track_id, partial, covered_start, covered_end)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (journey_id, track_id) DO NOTHING`,
        [
          user.id,
          dbJourneyId,
          localPart.track_id,
          partial,
          range?.covered_start ?? null,
          range?.covered_end ?? null,
        ],
      );
      if (inserted.rowCount) {
        result.partsMigrated++;
      } else {
        result.partsSkipped++;
      }
    }

    await client.query("COMMIT");
    result.missingRoutes = missingTrackIds.size;
    return result;
  } catch (error) {
    // A failed ROLLBACK means the connection itself is gone (the likeliest
    // cause of the failure in the first place): keep the original error, and
    // have the pool discard the client rather than hand it to the next caller
    await client.query("ROLLBACK").catch((rollbackError: Error) => {
      brokenConnection = rollbackError;
    });
    console.error("Error migrating local journeys:", error);
    throw new Error(
      `Failed to migrate journeys: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    client.release(brokenConnection);
  }
}
