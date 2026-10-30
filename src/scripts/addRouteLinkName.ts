#!/usr/bin/env tsx
/**
 * Add `link_name` to railway_routes
 *
 * What a route's link is called where the route shows it (the heritage railway's
 * name), in place of the default "Website". Only beside a link, as the CHECK says.
 *
 * Idempotent — safe to re-run. Run it before the app deploy that ships the column:
 * the tile function re-applied by that deploy reads it, and refuses to be created
 * without it.
 */

import pool from "../lib/db";

async function addRouteLinkName() {
  const client = await pool.connect();

  try {
    console.log("Adding link_name to railway_routes...");
    console.log("=====================================\n");

    await client.query(`
      ALTER TABLE railway_routes
      ADD COLUMN IF NOT EXISTS link_name TEXT;
    `);

    console.log("✓ Column link_name present");

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'railway_routes_link_name_needs_link'
        ) THEN
          ALTER TABLE railway_routes
          ADD CONSTRAINT railway_routes_link_name_needs_link
          CHECK (link_name IS NULL OR link IS NOT NULL);
        END IF;
      END
      $$;
    `);

    console.log("✓ Constraint railway_routes_link_name_needs_link present");

    console.log("\n=====================================");
    console.log("Done — now run: npm run applyVectorTiles");
    console.log("=====================================\n");
  } catch (error) {
    console.error("Error adding link_name:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
addRouteLinkName().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
