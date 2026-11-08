#!/usr/bin/env tsx
/**
 * Rename railway_routes.frequency to usage_tags
 *
 * The tags outgrew service frequency: they now also say what runs on a line
 * (S-Bahn, regional, tram-train, diversions), so the column says "usage tags".
 *
 * The tile functions in 02-vector-tiles.sql name the column inside `$$` bodies,
 * which Postgres stores as text and does not follow through a rename. So the file
 * is re-applied in the same transaction: nothing ever sees the renamed column with
 * the old functions, or the reverse. Run it with the matching checkout (the file
 * must already say usage_tags). Safe to run twice: an already renamed column is
 * left be, and the functions are re-applied either way.
 *
 * The app still running the old code reads `frequency` until it is replaced, so
 * run this right before that deploy's containers swap, not ahead of it. Route data
 * dumps taken before the rename name `frequency` and no longer restore over it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import pool from "../lib/db";

async function renameFrequencyToUsageTags() {
  const tilesSql = readFileSync(
    join(process.cwd(), "database", "init", "02-vector-tiles.sql"),
    "utf-8",
  );
  if (!/\busage_tags\b/.test(tilesSql)) {
    throw new Error("02-vector-tiles.sql does not use usage_tags yet; update the checkout first");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // As the deploy does for the same SQL: give up rather than queue every tile
    // query behind a long writer (a map data import in progress). Rerun after it.
    await client.query("SET LOCAL lock_timeout = '10s'");

    const { rows } = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'railway_routes'
        AND column_name IN ('frequency', 'usage_tags')
    `);
    const columns = new Set(rows.map((row) => row.column_name));

    if (columns.has("usage_tags")) {
      // Still re-apply the functions below: a column renamed by hand leaves them
      // reading `frequency`
      console.log("railway_routes.usage_tags already exists, nothing to rename");
    } else if (columns.has("frequency")) {
      console.log("Renaming railway_routes.frequency to usage_tags...");
      await client.query("ALTER TABLE railway_routes RENAME COLUMN frequency TO usage_tags");
    } else {
      throw new Error("railway_routes has neither frequency nor usage_tags");
    }

    console.log("Re-applying 02-vector-tiles.sql...");
    await client.query(tilesSql);

    await client.query("COMMIT");
    console.log("✓ The column is usage_tags, and the tile functions read it");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

renameFrequencyToUsageTags().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
