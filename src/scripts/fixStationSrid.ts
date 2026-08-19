#!/usr/bin/env tsx
/**
 * Give every geometry column an explicit SRID of 4326.
 *
 * The loader used to insert station points with a bare `ST_MakePoint`, which
 * produces SRID 0 — "unknown" rather than WGS84. That is now fixed at the source
 * (see loadRailwayData), but rows written by the old code keep SRID 0 until they
 * are reloaded, and an unknown SRID is not merely cosmetic:
 *
 *   - `coordinates && ST_MakeEnvelope(..., 4326)`, which is how a query is
 *     restricted to one region, raises "Operation on mixed SRID geometries";
 *   - `ST_Transform(coordinates, 3857)`, which fills coordinates_3857 for the
 *     tile server, raises "Input geometry has unknown (0) SRID".
 *
 * A full `importMapData` run rewrites every station anyway, so this is only for
 * a database that has not been reimported since. It is safe to run repeatedly:
 * rows already at 4326 are left alone. The coordinates themselves are unchanged
 * — they were always lon/lat, just unlabelled.
 *
 * The report at the end also shows whether the columns carry the SRID in their
 * type (`geometry(Point,4326)`) or not (`geometry`). A plain type means the live
 * schema has drifted from database/init/01-schema.sql, which only ever runs on a
 * fresh volume.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";

dotenv.config();

const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

/** Geometry columns that must all be WGS84. */
const COLUMNS: { table: string; column: string }[] = [
  { table: "stations", column: "coordinates" },
  { table: "railway_parts", column: "geometry" },
  { table: "railway_routes", column: "geometry" },
  { table: "railway_routes", column: "starting_coordinate" },
  { table: "railway_routes", column: "ending_coordinate" },
  { table: "admin_notes", column: "coordinate" },
];

async function fixStationSrid() {
  const client = await pool.connect();

  try {
    console.log("Checking geometry SRIDs...");
    console.log("=====================================\n");

    let totalFixed = 0;

    for (const { table, column } of COLUMNS) {
      // How the column is declared: `geometry(Point,4326)` enforces the SRID on
      // every insert, plain `geometry` accepts anything.
      const declared = await client.query<{ type: string }>(
        `SELECT format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = $1 AND a.attname = $2 AND a.attnum > 0`,
        [table, column],
      );

      if (declared.rowCount === 0) {
        console.log(`  ${table}.${column}: column not found, skipping`);
        continue;
      }

      const columnType = declared.rows[0].type;
      const enforcesSrid = columnType.includes("4326");

      const wrong = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM ${table}
         WHERE ${column} IS NOT NULL AND ST_SRID(${column}) <> 4326`,
      );
      const wrongCount = parseInt(wrong.rows[0].count, 10);

      if (wrongCount === 0) {
        console.log(`  ${table}.${column}: OK (${columnType})`);
        continue;
      }

      // The UPDATE also re-fires the sync trigger, refreshing the 3857 mirror.
      const updated = await client.query(
        `UPDATE ${table}
         SET ${column} = ST_SetSRID(${column}, 4326)
         WHERE ${column} IS NOT NULL AND ST_SRID(${column}) <> 4326`,
      );
      totalFixed += updated.rowCount ?? 0;

      console.log(
        `  ${table}.${column}: fixed ${updated.rowCount} row(s) (${columnType}${
          enforcesSrid ? "" : " — column does not enforce the SRID; schema drift?"
        })`,
      );
    }

    console.log("\n=====================================");
    console.log(
      totalFixed > 0
        ? `Set SRID 4326 on ${totalFixed} row(s).`
        : "Nothing to fix — every geometry is already SRID 4326.",
    );
    console.log("=====================================\n");
  } catch (error) {
    console.error("Error fixing geometry SRIDs:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

fixStationSrid().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
