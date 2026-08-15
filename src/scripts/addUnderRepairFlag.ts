#!/usr/bin/env tsx
/**
 * Add the `under_repair` flag to railway_routes
 *
 * Marks an invalid route whose OSM layout is only temporarily broken (bridge
 * works, a way split mid-rebuild) as opposed to one that really changed on the
 * ground. Admin-set, cleared whenever the route becomes valid again.
 *
 * Idempotent — safe to re-run. Run `npm run applyVectorTiles` afterwards so the
 * tile function starts emitting the new column.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function addUnderRepairFlag() {
  const client = await pool.connect();

  try {
    console.log("Adding under_repair flag to railway_routes...");
    console.log("=====================================\n");

    await client.query(`
      ALTER TABLE railway_routes
      ADD COLUMN IF NOT EXISTS under_repair BOOLEAN DEFAULT FALSE;
    `);

    console.log("✓ Column under_repair present");

    // Existing rows added before the DEFAULT would keep NULL; the app treats
    // NULL as "not under repair", but a concrete FALSE keeps the filters simple.
    const backfill = await client.query(`
      UPDATE railway_routes
      SET under_repair = FALSE
      WHERE under_repair IS NULL;
    `);

    console.log(`✓ Backfilled ${backfill.rowCount} rows to FALSE`);

    console.log("\n=====================================");
    console.log("Done — now run: npm run applyVectorTiles");
    console.log("=====================================\n");
  } catch (error) {
    console.error("Error adding under_repair flag:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
addUnderRepairFlag().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
