#!/usr/bin/env tsx
/**
 * Turn round the routes whose geometry was stored backwards.
 *
 * `mergeLinearChain` used to pick where a chain starts from whichever endpoint
 * occurred only once. A start click exactly on a node shared by two parts
 * truncated the first part to a point, left no endpoint unique at the start,
 * and the chain was built from the far end — so the stored geometry runs from
 * the end click to the start click, and `start_country`/`end_country`, read
 * off its first and last point, are swapped. The merge now follows path order,
 * so this cannot recur; this script repairs the rows written before that.
 *
 * A route is backwards when *both* clicks sit nearer the opposite end of its
 * geometry. Requiring both keeps a loop, whose clicks sit side by side at one
 * end, from reading as reversed. The repair is exact — `ST_Reverse`, not a
 * recalculation — so invalid routes are fixed too, and the geometry is
 * otherwise untouched (same length, same stations nearby). Partial rides'
 * fractions were measured along the old direction and are mirrored with it.
 *
 * One transaction. `--dry-run` lists what would change and rolls back.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";

dotenv.config();

const pool = new Pool(getDbConfig());
const dryRun = process.argv.includes("--dry-run");

async function fixReversedRoutes() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const reversed = await client.query<{
      track_id: number;
      from_station: string;
      to_station: string;
    }>(`
      SELECT track_id, from_station, to_station
      FROM railway_routes
      WHERE geometry IS NOT NULL
        AND starting_coordinate IS NOT NULL
        AND ending_coordinate IS NOT NULL
        AND ST_Distance(starting_coordinate, ST_EndPoint(geometry))
          < ST_Distance(starting_coordinate, ST_StartPoint(geometry))
        AND ST_Distance(ending_coordinate, ST_StartPoint(geometry))
          < ST_Distance(ending_coordinate, ST_EndPoint(geometry))
      ORDER BY track_id
      FOR UPDATE
    `);
    const trackIds = reversed.rows.map((row) => row.track_id);

    console.log(`${trackIds.length} route(s) stored backwards`);
    for (const row of reversed.rows) {
      console.log(`  Track ${row.track_id}: ${row.from_station} ⟷ ${row.to_station}`);
    }

    const mirrored = await client.query(
      `
      UPDATE user_logged_parts
      SET covered_start = 1 - covered_end, covered_end = 1 - covered_start
      WHERE track_id = ANY($1::int[]) AND covered_start IS NOT NULL
    `,
      [trackIds],
    );

    // The SET expressions read the row as it was, so the countries swap
    await client.query(
      `
      UPDATE railway_routes
      SET geometry = ST_Reverse(geometry),
          start_country = end_country,
          end_country = start_country,
          updated_at = CURRENT_TIMESTAMP
      WHERE track_id = ANY($1::int[])
    `,
      [trackIds],
    );

    console.log(`Mirrored ${mirrored.rowCount} partial ride(s)`);

    if (dryRun) {
      await client.query("ROLLBACK");
      console.log("Dry run — rolled back, nothing changed");
    } else {
      await client.query("COMMIT");
      console.log(`Turned round ${trackIds.length} route(s)`);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error fixing reversed routes:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

fixReversedRoutes().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
