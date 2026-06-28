#!/usr/bin/env tsx
/**
 * Drop the track_number column from railway_routes.
 *
 * The "Local route number(s)" field proved useless: line numbering is
 * inconsistent across countries (Sweden doesn't number lines, Austria has
 * separate passenger/internal numbers, German infrastructure numbers are
 * internal-only while passengers navigate by service lines like S7/RE9), and
 * nobody looks up a trip by infrastructure route number anyway.
 *
 * Idempotent (uses IF EXISTS). After running, re-apply vector tiles
 * (`npm run applyVectorTiles`) and restart Martin so the route tile drops the
 * removed column.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";

dotenv.config();

const pool = new Pool(getDbConfig());

async function dropTrackNumber() {
  const client = await pool.connect();

  try {
    console.log("Dropping railway_routes.track_number column...");
    console.log("=====================================\n");

    await client.query(`
      ALTER TABLE railway_routes
      DROP COLUMN IF EXISTS track_number;
    `);

    console.log("✓ Column dropped (or already absent)\n");
    console.log("=====================================");
    console.log("Re-apply vector tiles and restart Martin:");
    console.log("  npm run applyVectorTiles");
    console.log("=====================================\n");
  } catch (error) {
    console.error("Error dropping track_number column:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

dropTrackNumber().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
