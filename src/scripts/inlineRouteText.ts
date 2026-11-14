#!/usr/bin/env tsx
/**
 * Keep the route and scenic-line text inline, out of TOAST
 *
 * The geometries have PostGIS's `main` storage and the text columns had the
 * default `extended`. When a row is too big for its page, Postgres moves the
 * `extended` values over ~24 bytes out of line before it touches a `main`
 * one. So every non-empty usage_tags, and the longer names and descriptions,
 * sat in the TOAST table, each read a TOAST index lookup (115ms to read
 * usage_tags over 7.4k routes, against 5ms for the mostly empty other_names).
 * With the text `main` too, the geometries, the biggest `main` values, go out
 * first and the text stays in the row.
 *
 * Storage applies to tuples written after the change, and an UPDATE that
 * leaves a value alone keeps its pointer. VACUUM FULL rewrites every row
 * with each out-of-line value fetched back and re-stored under the new
 * setting, so it moves the text back in. It holds an ACCESS EXCLUSIVE lock
 * for the rewrite (seconds), during which tile and route reads wait.
 *
 * Idempotent. Prints the heap and TOAST sizes and the out-of-line counts
 * before and after. 01-schema.sql sets the same storage for a new database.
 */

import type { PoolClient } from "pg";
import pool from "../lib/db";

/** The same lists as the ALTER TABLEs in 01-schema.sql. */
const TABLES: Record<string, string[]> = {
  railway_routes: [
    "name",
    "other_names",
    "from_station",
    "to_station",
    "description",
    "usage_tags",
    "link",
    "link_name",
    "error_message",
  ],
  scenic_lines: ["from_station", "to_station", "error_message"],
};

function formatMegabytes(bytes: string): string {
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)}MB`;
}

async function report(client: PoolClient, label: string) {
  console.log(`\n${label}`);
  for (const [table, columns] of Object.entries(TABLES)) {
    const sizes = await client.query<{ heap: string; toast: string }>(
      `SELECT pg_relation_size(c.oid) AS heap,
              coalesce(pg_total_relation_size(nullif(c.reltoastrelid, 0::oid)), 0) AS toast
       FROM pg_class c WHERE c.oid = $1::regclass`,
      [table],
    );
    const { heap, toast } = sizes.rows[0];

    // pg_column_toast_chunk_id is NULL unless the value is stored out of line
    const countColumns = columns
      .map((column) => `count(pg_column_toast_chunk_id(${column}))::int AS ${column}`)
      .join(", ");
    const counts = await client.query<Record<string, number>>(
      `SELECT count(*)::int AS rows, ${countColumns} FROM ${table}`,
    );
    const { rows, ...outOfLine } = counts.rows[0];
    const toasted = Object.entries(outOfLine)
      .filter(([, count]) => count > 0)
      .map(([column, count]) => `${column} ${count}`);

    console.log(
      `  ${table}: ${rows} rows, heap ${formatMegabytes(heap)}, TOAST ${formatMegabytes(toast)}`,
    );
    console.log(`    text out of line: ${toasted.length > 0 ? toasted.join(", ") : "none"}`);
  }

  // The read the audit measured. Best of three, so the cache is warm.
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await client.query("SELECT sum(cardinality(usage_tags)) FROM railway_routes");
    best = Math.min(best, performance.now() - start);
  }
  console.log(`  sum(cardinality(usage_tags)) over railway_routes: ${best.toFixed(1)}ms`);
}

async function inlineRouteText() {
  const client = await pool.connect();

  try {
    await report(client, "Before:");

    // Fail rather than queue every reader behind a lock it can't get (a
    // running import or recalculation). Rerun afterwards.
    await client.query("SET lock_timeout = '10s'");

    for (const [table, columns] of Object.entries(TABLES)) {
      console.log(`\nSetting ${table}'s text columns to STORAGE MAIN...`);
      const alterColumns = columns
        .map((column) => `ALTER COLUMN ${column} SET STORAGE MAIN`)
        .join(", ");
      await client.query(`ALTER TABLE ${table} ${alterColumns}`);

      console.log(`Rewriting ${table} (VACUUM FULL)...`);
      const start = performance.now();
      await client.query(`VACUUM (FULL, ANALYZE) ${table}`);
      console.log(`  done in ${((performance.now() - start) / 1000).toFixed(1)}s`);
    }

    await report(client, "After:");
  } catch (error) {
    console.error("Error moving the route text inline:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

inlineRouteText().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
