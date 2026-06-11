#!/usr/bin/env tsx
/**
 * Resync every SERIAL/owned sequence with the actual data in its table.
 *
 * Symptom this fixes: inserts fail with
 *   "duplicate key value violates unique constraint <table>_pkey"
 * even though no id is supplied. This happens when rows were loaded with
 * explicit ids (e.g. an old SQL dump/import that predated the setval calls)
 * without advancing the underlying sequence, so nextval() returns ids that
 * already exist.
 *
 * Discovers every sequence owned by a column from the system catalog, then
 * sets each to MAX(column) so the next insert gets MAX+1. Safe to run
 * repeatedly.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";

dotenv.config();

const pool = new Pool(getDbConfig());

interface OwnedSequence {
  sequence_name: string;
  table_name: string;
  column_name: string;
}

async function fixSequences() {
  const client = await pool.connect();

  try {
    console.log("Resyncing owned sequences with table data...");
    console.log("=====================================\n");

    // Every sequence that is OWNED BY a column (i.e. backs a SERIAL/IDENTITY).
    const { rows: sequences } = await client.query<OwnedSequence>(`
      SELECT
        seq.relname AS sequence_name,
        tbl.relname AS table_name,
        col.attname AS column_name
      FROM pg_class seq
      JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype = 'a'
      JOIN pg_class tbl ON tbl.oid = dep.refobjid
      JOIN pg_attribute col ON col.attrelid = tbl.oid AND col.attnum = dep.refobjsubid
      JOIN pg_namespace ns ON ns.oid = seq.relnamespace
      WHERE seq.relkind = 'S' AND ns.nspname = 'public'
      ORDER BY tbl.relname;
    `);

    for (const { sequence_name, table_name, column_name } of sequences) {
      // setval to MAX(col); when the table is empty, reset to 1 with
      // is_called=false so the first insert yields 1.
      const result = await client.query<{ max_id: number | null; new_value: number }>(
        `SELECT
           (SELECT MAX(${column_name}) FROM ${table_name}) AS max_id,
           CASE
             WHEN (SELECT MAX(${column_name}) FROM ${table_name}) IS NULL
               THEN setval('${sequence_name}', 1, false)
             ELSE setval('${sequence_name}', (SELECT MAX(${column_name}) FROM ${table_name}))
           END AS new_value`,
      );

      const { max_id, new_value } = result.rows[0];
      console.log(
        `  ${table_name}.${column_name}: max=${max_id ?? "∅"} → sequence set to ${new_value}`,
      );
    }

    console.log("\n=====================================");
    console.log(`Resynced ${sequences.length} sequence(s)!`);
    console.log("=====================================\n");
  } catch (error) {
    console.error("Error resyncing sequences:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

fixSequences().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
