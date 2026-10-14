#!/usr/bin/env tsx
/**
 * Migration: let a route belong to more than one named line.
 *
 * Where two lines share one stretch of track — the Tokaido and Chuo Main Lines
 * between Nagoya and Kanayama — the stretch is one route (it is ridden once, and
 * counted once), but it is part of both lines. `name` stays the line the route is
 * called by; the new `other_names` lists the rest, so the line search and its
 * highlight find the stretch under either name.
 *
 * Run it on the server before pushing the code that reads the column: the deploy
 * re-applies 02-vector-tiles.sql, whose route tile selects it.
 *
 * Idempotent — safe to re-run.
 */

import pool from "../lib/db";

async function addOtherLineNames() {
  const client = await pool.connect();

  try {
    console.log("Adding railway_routes.other_names...");
    console.log("=====================================\n");

    await client.query(`
      ALTER TABLE railway_routes
      ADD COLUMN IF NOT EXISTS other_names TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
    `);
    console.log("✓ Column railway_routes.other_names is in place");

    await client.query(`
      ALTER TABLE railway_routes
      DROP CONSTRAINT IF EXISTS railway_routes_other_names_need_name,
      ADD CONSTRAINT railway_routes_other_names_need_name
        CHECK (cardinality(other_names) = 0 OR name IS NOT NULL)
    `);
    console.log("✓ Constraint railway_routes_other_names_need_name is in place\n");

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

addOtherLineNames().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
