#!/usr/bin/env tsx
/**
 * Migration: give railway_routes a line name, and retire the "Non-JR line" tag.
 *
 * Two changes that belong to the same move. Japan's network is named line by
 * line, so a route there is identified by its name rather than by its two
 * endpoints — hence the new `name` column (NULL everywhere else; Europe names
 * nothing).
 *
 * The same move makes the "Non-JR line" frequency tag redundant: the Special
 * usage type now *reads* "Non-JR line" in the Japan region, so a tag saying the
 * same thing is duplicated on screen. Every use of it is removed; because a tag
 * exists only while some route carries it, that also drops it from the
 * TagInput's suggestion list.
 *
 * Idempotent — safe to re-run.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";

dotenv.config();

const pool = new Pool(getDbConfig());

/** The frequency tag the Special usage label replaced. */
const RETIRED_TAG = "Non-JR line";

async function addRouteName() {
  const client = await pool.connect();

  try {
    console.log("Adding railway_routes.name and retiring the obsolete frequency tag...");
    console.log("=====================================\n");

    await client.query(`ALTER TABLE railway_routes ADD COLUMN IF NOT EXISTS name TEXT`);
    console.log("✓ Column railway_routes.name is in place");

    const stripped = await client.query(
      `
      UPDATE railway_routes
      SET frequency = array_remove(frequency, $1),
          updated_at = CURRENT_TIMESTAMP
      WHERE $1 = ANY(frequency)
      RETURNING track_id, from_station, to_station
      `,
      [RETIRED_TAG],
    );

    console.log(`✓ Removed the "${RETIRED_TAG}" tag from ${stripped.rowCount} route(s)\n`);

    if (stripped.rowCount) {
      stripped.rows.forEach((row, index) => {
        console.log(
          `  ${index + 1}. Track ${row.track_id}: ${row.from_station} ⟷ ${row.to_station}`,
        );
      });
      console.log("");
    }

    console.log("=====================================");
    console.log("Migration complete!");
    console.log("Run `npm run applyVectorTiles` so the tiles serve the new column.");
    console.log("=====================================\n");
  } catch (error) {
    console.error("Error running migration:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

addRouteName().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
