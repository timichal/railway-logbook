#!/usr/bin/env tsx
/**
 * Add `closed` and `closed_on` to railway_routes
 *
 * A closed route is a line with no passenger service any more, kept for the rides
 * logged on it (see the columns' comment in 01-schema.sql). `closed_on` is the
 * date the service ended, where known, and only ever beside `closed`. A closed
 * route is never under repair: that flag says the line comes back.
 *
 * Idempotent — safe to re-run. Run it before the app deploy that ships the
 * columns: the tile function re-applied by that deploy reads them, and refuses to
 * be created without them.
 */

import pool from "../lib/db";

async function addRouteClosed() {
  const client = await pool.connect();

  try {
    console.log("Adding closed / closed_on to railway_routes...");
    console.log("=====================================\n");

    await client.query(`
      ALTER TABLE railway_routes
      ADD COLUMN IF NOT EXISTS closed BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS closed_on DATE;
    `);

    console.log("✓ Columns closed, closed_on present");

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'railway_routes_closed_on_needs_closed'
        ) THEN
          ALTER TABLE railway_routes
          ADD CONSTRAINT railway_routes_closed_on_needs_closed
          CHECK (closed_on IS NULL OR closed);
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'railway_routes_closed_not_under_repair'
        ) THEN
          ALTER TABLE railway_routes
          ADD CONSTRAINT railway_routes_closed_not_under_repair
          CHECK (NOT (closed AND under_repair));
        END IF;
      END
      $$;
    `);

    console.log(
      "✓ Constraints railway_routes_closed_on_needs_closed, railway_routes_closed_not_under_repair present",
    );

    console.log("\n=====================================");
    console.log("Done — now run: npm run applyVectorTiles");
    console.log("=====================================\n");
  } catch (error) {
    console.error("Error adding closed:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
addRouteClosed().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
