#!/usr/bin/env tsx
/**
 * Add the public map sharing columns to user_preferences.
 *
 * `public_map_enabled` gates the anonymous /shared/<token> view (off by
 * default — a map is private until its owner shares it), `public_map_token` is
 * the URL slug, minted lazily by getPublicMapSettings().
 *
 * Idempotent: safe to re-run.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function addPublicMapSharing() {
  const client = await pool.connect();

  try {
    console.log("Adding public map sharing columns to user_preferences...");
    console.log("=====================================\n");

    await client.query(`
      ALTER TABLE user_preferences
        ADD COLUMN IF NOT EXISTS public_map_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS public_map_token TEXT
    `);
    console.log("✓ Columns present");

    // A unique index rather than a table constraint, so the IF NOT EXISTS above
    // can be paired with an equally repeatable index creation.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_public_map_token_key
        ON user_preferences (public_map_token)
    `);
    console.log("✓ Unique index on public_map_token present");

    const counts = await client.query(`
      SELECT
        COUNT(*) AS rows,
        COUNT(*) FILTER (WHERE public_map_enabled) AS shared,
        COUNT(public_map_token) AS with_token
      FROM user_preferences
    `);
    const { rows: rowCount, shared, with_token } = counts.rows[0];
    console.log(
      `\n${rowCount} preference rows — ${shared} sharing publicly, ${with_token} with a token`,
    );

    console.log("\n=====================================");
    console.log("Public map sharing columns ready!");
    console.log("=====================================\n");
  } catch (error) {
    console.error("Error adding public map sharing columns:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
addPublicMapSharing().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
