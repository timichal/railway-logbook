"use server";

import { getUser } from "./authActions";
import { withTransaction } from "./db";
import { sanitizeRange } from "./journeyQueries";

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

  return withTransaction(async (client) => {
    const result: JourneyMigrationResult = {
      journeysMigrated: 0,
      journeysSkipped: 0,
      partsMigrated: 0,
      partsSkipped: 0,
      missingRoutes: 0,
    };

    // A journey already on the account with the same name and date is taken to
    // be this one, merged into it on an earlier login. Each account journey is
    // matched at most once: the k-th local journey of a name and date takes the
    // k-th account one (by id), and the rest are created. Two local journeys of
    // one name and date are two journeys that day (an out-and-back), not one
    // journey twice. One statement for the lot.
    //
    // The created journeys' ids are drawn from the sequence here, in the local
    // list's order, and inserted explicitly. The matching above depends on it: if
    // this commits but the reply is lost, the local copy stays and the next
    // login matches again by id order, so the k-th local journey must have got
    // the k-th id. An INSERT drawing its own ids would number them in whatever
    // order the join happened to produce. The subquery's ORDER BY is kept (a
    // volatile function above it stops it being flattened), and nextval runs on
    // its rows as they come out, sorted.
    const journeys = await client.query<{ local_id: string; id: number; created: boolean }>(
      `WITH local AS (
         SELECT local_id, name, description, date, ord,
                row_number() OVER (PARTITION BY name, date ORDER BY ord) AS k
         FROM unnest($2::text[], $3::text[], $4::text[], $5::date[])
           WITH ORDINALITY AS l(local_id, name, description, date, ord)
       ),
       account AS (
         SELECT id, name, date,
                row_number() OVER (PARTITION BY name, date ORDER BY id) AS k
         FROM user_journeys
         WHERE user_id = $1 AND (name, date) IN (SELECT name, date FROM local)
       ),
       matched AS (
         SELECT local.*, account.id
         FROM local
         LEFT JOIN account USING (name, date, k)
       ),
       numbered AS (
         SELECT m.local_id, m.name, m.description, m.date,
                nextval(pg_get_serial_sequence('user_journeys', 'id')) AS id
         FROM (SELECT * FROM matched WHERE id IS NULL ORDER BY ord) m
       ),
       created AS (
         INSERT INTO user_journeys (id, user_id, name, description, date)
         SELECT id, $1, name, description, date FROM numbered
       )
       SELECT local_id, id, false AS created FROM matched WHERE id IS NOT NULL
       UNION ALL
       SELECT local_id, id, true FROM numbered`,
      [
        user.id,
        localJourneys.map((journey) => journey.id),
        localJourneys.map((journey) => journey.name),
        localJourneys.map((journey) => journey.description),
        localJourneys.map((journey) => journey.date),
      ],
    );

    // Local journey id → account journey id
    const journeyIdMap = new Map<string, number>();
    for (const row of journeys.rows) {
      journeyIdMap.set(row.local_id, row.id);
      if (row.created) result.journeysMigrated++;
      else result.journeysSkipped++;
    }

    const existingRoutes = await client.query<{ track_id: number }>(
      "SELECT track_id FROM railway_routes WHERE track_id = ANY($1::int[])",
      [[...new Set(localParts.map((part) => part.track_id))]],
    );
    const existingTrackIds = new Set(existingRoutes.rows.map((row) => row.track_id));
    const missingTrackIds = new Set<number>();

    // The parts to insert, as the columns unnest takes
    const journeyIds: number[] = [];
    const trackIds: number[] = [];
    const partials: boolean[] = [];
    const starts: (number | null)[] = [];
    const ends: (number | null)[] = [];
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
      journeyIds.push(dbJourneyId);
      trackIds.push(localPart.track_id);
      partials.push(partial);
      starts.push(range?.covered_start ?? null);
      ends.push(range?.covered_end ?? null);
    }

    // One row per (journey, route): a route already logged on the journey
    // (merged into on an earlier login, or listed twice) is skipped. In one
    // statement, the first of two in the list is the one kept, as unnest keeps
    // the order.
    if (journeyIds.length > 0) {
      const inserted = await client.query(
        `INSERT INTO user_logged_parts (user_id, journey_id, track_id, partial, covered_start, covered_end)
         SELECT $1, journey_id, track_id, partial, covered_start, covered_end
         FROM unnest($2::int[], $3::int[], $4::boolean[], $5::float8[], $6::float8[])
           AS p(journey_id, track_id, partial, covered_start, covered_end)
         ON CONFLICT (journey_id, track_id) DO NOTHING`,
        [user.id, journeyIds, trackIds, partials, starts, ends],
      );
      const migrated = inserted.rowCount ?? 0;
      result.partsMigrated += migrated;
      result.partsSkipped += journeyIds.length - migrated;
    }

    result.missingRoutes = missingTrackIds.size;
    return result;
  });
}
