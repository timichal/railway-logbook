#!/usr/bin/env tsx
/**
 * Make admin_notes.note_type NOT NULL
 *
 * Every note is typed now, so the untyped (legacy) path is gone from the app.
 * This aligns the column with 01-schema.sql. Aborts without changing anything
 * if any untyped note is still there — type those first, then re-run.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function requireNoteType() {
  const client = await pool.connect();

  try {
    console.log("Making admin_notes.note_type NOT NULL...");
    console.log("=====================================\n");

    const untyped = await client.query<{ id: number; text: string }>(`
      SELECT id, text
      FROM admin_notes
      WHERE note_type IS NULL
      ORDER BY id;
    `);

    if (untyped.rowCount! > 0) {
      console.error(`✗ ${untyped.rowCount} note(s) still have no type:\n`);
      untyped.rows.forEach((row) => {
        console.error(`  #${row.id}: ${row.text.slice(0, 80).replace(/\s+/g, " ")}`);
      });
      console.error("\nAssign a type to each (Admin → Notes tab), then re-run this script.");
      process.exitCode = 1;
      return;
    }

    await client.query(`
      ALTER TABLE admin_notes
      ALTER COLUMN note_type SET NOT NULL;
    `);

    console.log("✓ note_type is now NOT NULL\n");
    console.log("=====================================\n");
  } catch (error) {
    console.error("Error updating admin_notes.note_type:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
requireNoteType().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
