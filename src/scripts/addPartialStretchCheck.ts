#!/usr/bin/env tsx
/**
 * Add `logged_parts_partial_has_stretch` to `user_logged_parts`: a ride is partial
 * exactly when it carries its stretch (`loggedRide`, `src/lib/shared/routeCoverage.ts`).
 *
 * A partial ride with no stretch ("extent unknown") was fixed by hand before this
 * ran, so the constraint goes on as it is. Where a row still breaks it, nothing is
 * changed and the rows are listed (journey, date, route) to fix first. Idempotent —
 * safe to re-run.
 *
 * **Run it once that deploy is live**, not during it: the app before it could
 * still write a partial ride without a stretch (its per-route partial endpoint),
 * which the constraint would then refuse with a 500. The check and the ALTER are
 * one transaction, with writes to the table locked out from the check on, so no
 * row can slip in between. A lock it can't get within 10s fails the run rather
 * than queue every request behind it: rerun it.
 */

import pool from "../lib/db";

const CONSTRAINT = "logged_parts_partial_has_stretch";

async function addPartialStretchCheck() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    // Reads go on; writes wait until the ALTER is in
    await client.query("LOCK TABLE user_logged_parts IN SHARE ROW EXCLUSIVE MODE");

    const existing = await client.query(
      `SELECT 1 FROM pg_constraint
       WHERE conname = $1 AND conrelid = 'user_logged_parts'::regclass`,
      [CONSTRAINT],
    );
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      console.log(`✓ ${CONSTRAINT} is already in place`);
      return;
    }

    const broken = await client.query<{
      user_id: number;
      journey_id: number;
      name: string;
      date: string;
      route: string;
      partial: boolean;
    }>(
      `SELECT ulp.user_id, ulp.journey_id, uj.name, uj.date,
              rr.from_station || ' – ' || rr.to_station AS route, ulp.partial
       FROM user_logged_parts ulp
       JOIN user_journeys uj ON uj.id = ulp.journey_id
       JOIN railway_routes rr ON rr.track_id = ulp.track_id
       WHERE ulp.partial <> (ulp.covered_start IS NOT NULL)
       ORDER BY ulp.user_id, uj.date`,
    );
    if (broken.rowCount) {
      await client.query("ROLLBACK");
      console.log(`✗ ${broken.rowCount} logged routes break the rule; nothing was changed:`);
      for (const row of broken.rows) {
        const what = row.partial ? "partial, no stretch" : "whole, with a stretch";
        console.log(
          `  user ${row.user_id}, journey ${row.journey_id} "${row.name}" (${row.date}): ${row.route} — ${what}`,
        );
      }
      process.exitCode = 1;
      return;
    }

    await client.query(
      `ALTER TABLE user_logged_parts
       ADD CONSTRAINT ${CONSTRAINT} CHECK (partial = (covered_start IS NOT NULL))`,
    );
    await client.query("COMMIT");
    console.log(`✓ ${CONSTRAINT} added`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

addPartialStretchCheck().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
