#!/usr/bin/env tsx
/**
 * Migration: give user_logged_parts a covered stretch.
 *
 * Adds covered_start / covered_end — fractions along railway_routes.geometry
 * marking which part of the route a journey actually rode. Both NULL (the value
 * every existing row keeps) means the extent is unknown: the whole route when
 * partial = FALSE, or a partial ride whose extent was never captured.
 *
 * Idempotent: safe to run repeatedly.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";

dotenv.config();

const pool = new Pool(getDbConfig());

async function addCoveredRanges() {
  const client = await pool.connect();

  try {
    console.log("Adding covered_start / covered_end to user_logged_parts...");
    console.log("=====================================\n");

    await client.query(`
      ALTER TABLE user_logged_parts
        ADD COLUMN IF NOT EXISTS covered_start DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS covered_end DOUBLE PRECISION
    `);
    console.log("✓ Columns present");

    // Guard the invariants the app relies on: both set or both NULL, and a
    // non-empty range inside [0, 1]
    await client.query(`
      ALTER TABLE user_logged_parts
        DROP CONSTRAINT IF EXISTS logged_parts_covered_range
    `);
    await client.query(`
      ALTER TABLE user_logged_parts
        ADD CONSTRAINT logged_parts_covered_range CHECK (
          (covered_start IS NULL) = (covered_end IS NULL)
          AND (covered_start IS NULL OR (covered_start >= 0 AND covered_end <= 1 AND covered_start < covered_end))
        )
    `);
    console.log("✓ Range constraint applied");

    const counts = await client.query<{ total: string; with_range: string }>(`
      SELECT count(*) AS total, count(covered_start) AS with_range
      FROM user_logged_parts
    `);
    const { total, with_range } = counts.rows[0];

    console.log("\n=====================================");
    console.log(`${total} logged parts, ${with_range} with a known covered stretch`);
    console.log("=====================================\n");
  } catch (error) {
    console.error("Error adding covered range columns:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

addCoveredRanges().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
