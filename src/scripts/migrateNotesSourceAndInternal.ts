#!/usr/bin/env tsx
/**
 * Migration: admin notes "Source" field + "Usage (internal)" type
 *
 * 1. Adds the optional `source` TEXT column to admin_notes.
 * 2. Widens the note_type CHECK constraint to allow 'UsageInternal'.
 * 3. Reclassifies all existing 'Usage' notes to 'UsageInternal' so they drop off
 *    the public user map until the admin reviews each one and promotes it back to
 *    'Usage' (which republishes it).
 *
 * Idempotent: safe to re-run. Note that step 3 only ever moves Usage -> UsageInternal,
 * so re-running after publishing will NOT re-hide already-published notes.
 *
 * Reference pattern: markAllRoutesInvalid.ts
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";

dotenv.config();

const pool = new Pool(getDbConfig());

async function migrate() {
  const client = await pool.connect();

  try {
    console.log("Migrating admin_notes: source column + Usage (internal) type...");
    console.log("=====================================\n");

    await client.query("ALTER TABLE admin_notes ADD COLUMN IF NOT EXISTS source TEXT;");
    console.log("✓ Ensured `source` column exists");

    await client.query(
      "ALTER TABLE admin_notes DROP CONSTRAINT IF EXISTS admin_notes_note_type_check;",
    );
    await client.query(
      `ALTER TABLE admin_notes ADD CONSTRAINT admin_notes_note_type_check
       CHECK (note_type IN ('Usage', 'UsageInternal', 'Works', 'Todo'));`,
    );
    console.log("✓ Widened note_type CHECK to include 'UsageInternal'");

    const result = await client.query(
      `UPDATE admin_notes
       SET note_type = 'UsageInternal', updated_at = CURRENT_TIMESTAMP
       WHERE note_type = 'Usage'
       RETURNING id;`,
    );
    console.log(`✓ Reclassified ${result.rowCount} existing 'Usage' note(s) to 'UsageInternal'`);
    console.log("  (review them on the admin map and switch back to 'Usage' to publish)");

    console.log("\n=====================================");
    console.log("Migration complete!");
    console.log("=====================================\n");
  } catch (error) {
    console.error("Migration error:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
