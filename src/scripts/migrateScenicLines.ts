#!/usr/bin/env tsx
/**
 * Migration: scenic lines become their own table.
 *
 * Scenic used to be a flag on railway_routes, but a scenic stretch of track
 * almost never starts and ends where a route does. It is now `scenic_lines`,
 * drawn by the admin like a route (two click points, the same pathfinder) and
 * used for highlighting only. The old flags are dropped, not converted: they
 * were tied to route boundaries, which is the whole problem.
 *
 * One transaction: create the table, drop `railway_routes.scenic`, then re-apply
 * 02-vector-tiles.sql, whose guarded block adds the table's Web Mercator column,
 * index and sync trigger now that the table exists (and whose route tile no
 * longer reads the dropped column). Idempotent.
 *
 * On the server, run it only after the deploy carrying this change has finished:
 * the code it replaces reads `scenic`, and the new code tolerates the column
 * still being there.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";
import { getDbConfig } from "../lib/dbConfig";

dotenv.config();

async function migrateScenicLines() {
  const client = new Client(getDbConfig());
  await client.connect();

  try {
    await client.query("BEGIN");

    console.log("Creating scenic_lines...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS scenic_lines (
          id SERIAL PRIMARY KEY,
          from_station TEXT NOT NULL,
          to_station TEXT NOT NULL,
          geometry GEOMETRY(LINESTRING, 4326) NOT NULL,
          length_km NUMERIC NOT NULL,
          start_country VARCHAR(2) CHECK (start_country ~ '^[A-Z]{2}$'),
          end_country VARCHAR(2) CHECK (end_country ~ '^[A-Z]{2}$'),
          starting_coordinate GEOMETRY(POINT, 4326) NOT NULL,
          ending_coordinate GEOMETRY(POINT, 4326) NOT NULL,
          is_valid BOOLEAN NOT NULL DEFAULT TRUE,
          error_message TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_scenic_lines_geometry ON scenic_lines USING GIST (geometry);
      DROP TRIGGER IF EXISTS scenic_lines_update_timestamp ON scenic_lines;
      CREATE TRIGGER scenic_lines_update_timestamp
      BEFORE UPDATE ON scenic_lines
      FOR EACH ROW
      EXECUTE FUNCTION update_timestamp();
    `);

    const flagged = await client.query(`
      SELECT count(*)::int AS count
      FROM information_schema.columns
      WHERE table_name = 'railway_routes' AND column_name = 'scenic'
    `);
    if (flagged.rows[0].count > 0) {
      const scenic = await client.query(
        "SELECT count(*)::int AS count FROM railway_routes WHERE scenic",
      );
      console.log(`Dropping railway_routes.scenic (${scenic.rows[0].count} routes flagged)...`);
      await client.query("ALTER TABLE railway_routes DROP COLUMN scenic");
    } else {
      console.log("railway_routes.scenic already dropped");
    }

    console.log("Re-applying 02-vector-tiles.sql...");
    await client.query(
      readFileSync(join(process.cwd(), "database", "init", "02-vector-tiles.sql"), "utf-8"),
    );

    await client.query("COMMIT");
    console.log("✓ Scenic lines migration complete");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

migrateScenicLines().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
