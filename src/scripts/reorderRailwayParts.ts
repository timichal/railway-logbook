#!/usr/bin/env tsx
/**
 * Rewrite `railway_parts` in spatial order, once.
 *
 * Rows sat in the order they were first imported (file order, OSM id order), in a
 * heap left half empty by the full reimports of old. Measured locally on 2026-11-16,
 * 64 routes' 50km loads touched 90,879 heap pages (4.6 parts a page) and five
 * z10 tiles 3,302. Rewritten in the geohash order of each part's centroid, they
 * touched 21,562 (19.5 a page) and 679, and the table shrank from 1243MB + 361MB
 * of indexes to 619MB + 172MB. With a warm cache a recalculation barely changed
 * (1.8 → 1.7 min); the gain is in reads from disk, which is what matters on the
 * server, whose 1GB of shared_buffers couldn't hold the old heap. The import
 * writes only the parts that changed (`applyStagedParts`), so the order holds,
 * decaying only by the few parts each deploy moves or adds. Rerun it if that
 * decay ever shows (the before and after sizes it prints are a fair guide).
 *
 * Built beside the table and swapped in, not rewritten in place. `CLUSTER` and
 * `VACUUM FULL` take ACCESS EXCLUSIVE for the whole rewrite and would block every
 * tile query; a DELETE and INSERT of every row would leave the heap twice its
 * size (the old half empty, never handed back) and every index bloated. Here the
 * old table keeps serving reads while the copy and its indexes are built, under
 * a SHARE lock that holds off only writers (an import). The swap at the end
 * (drop, rename, re-attach the trigger) is the one moment readers wait, with
 * `lock_timeout` capping that wait: a timeout rolls everything back.
 *
 * The indexes, the trigger and the constraint names are carried over from the
 * live table, whatever they are by then. Anything this can't carry (a foreign
 * key, a view, a grant, a policy, storage options) makes it refuse before it
 * starts. Ids are unchanged and every query orders by id, so no result changes.
 *
 * Run it between deploys, never during one: an import blocks on the lock, and an
 * app deploy re-applying `02-vector-tiles.sql` times out on it and has to be
 * rerun. It needs free disk for a second copy of the table and its indexes
 * (printed below). `pg_stat_statements` keys queries on relation OIDs, so the
 * statistics of every query on the table start over under new entries.
 */

import type { PoolClient } from "pg";
import pool from "../lib/db";

const TABLE = "railway_parts";
const COPY = "railway_parts_reordered";
const SWAP_LOCK_TIMEOUT = "10s";

/** Refuse what the copy wouldn't carry over. */
async function assertNothingToLose(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ problem: string }>(
    `SELECT format('constraint %s (%s)', conname, pg_get_constraintdef(oid)) AS problem
     FROM pg_constraint
     WHERE (conrelid = $1::regclass AND contype NOT IN ('p', 'n', 'c'))
        OR confrelid = $1::regclass
     UNION ALL
     SELECT format('dependent %s', pg_describe_object(classid, objid, objsubid))
     FROM pg_depend
     WHERE refobjid = $1::regclass AND refclassid = 'pg_class'::regclass
       AND classid NOT IN ('pg_class'::regclass, 'pg_constraint'::regclass,
                           'pg_trigger'::regclass, 'pg_type'::regclass,
                           'pg_attrdef'::regclass)
     UNION ALL
     SELECT 'grants ' || relacl::text FROM pg_class WHERE oid = $1::regclass AND relacl IS NOT NULL
     UNION ALL
     SELECT 'options ' || reloptions::text FROM pg_class WHERE oid = $1::regclass AND reloptions IS NOT NULL
     UNION ALL
     SELECT 'policy ' || polname FROM pg_policy WHERE polrelid = $1::regclass`,
    [TABLE],
  );
  if (rows.length > 0) {
    throw new Error(
      `${TABLE} has what this script doesn't carry over to the copy:\n  ${rows
        .map((row) => row.problem)
        .join("\n  ")}`,
    );
  }
}

async function tableSize(client: PoolClient, table: string): Promise<string> {
  const { rows } = await client.query<{ heap: string; indexes: string }>(
    `SELECT pg_size_pretty(pg_table_size($1::regclass)) AS heap,
            pg_size_pretty(pg_indexes_size($1::regclass)) AS indexes`,
    [table],
  );
  return `${rows[0].heap} heap + ${rows[0].indexes} indexes`;
}

/** Run a step and print how long it took. */
async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`${label}... `);
  const start = performance.now();
  const result = await run();
  console.log(`${((performance.now() - start) / 1000).toFixed(1)}s`);
  return result;
}

async function reorderRailwayParts() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    // Every lock below waits at most this long, the swap's included.
    await client.query(`SET LOCAL lock_timeout = '${SWAP_LOCK_TIMEOUT}'`);
    await step("Holding off writers", () => client.query(`LOCK TABLE ${TABLE} IN SHARE MODE`));
    await assertNothingToLose(client);
    console.log(`Before: ${await tableSize(client, TABLE)} (about as much disk again is needed)`);

    const indexes = (
      await client.query<{ name: string; definition: string; primary: boolean }>(
        `SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS definition,
                i.indisprimary AS primary
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
         WHERE i.indrelid = $1::regclass
         ORDER BY c.relname`,
        [TABLE],
      )
    ).rows;
    const triggers = (
      await client.query<{ definition: string }>(
        `SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger
         WHERE tgrelid = $1::regclass AND NOT tgisinternal ORDER BY tgname`,
        [TABLE],
      )
    ).rows;
    const constraints = (
      await client.query<{ name: string; definition: string }>(
        `SELECT conname AS name, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint WHERE conrelid = $1::regclass AND contype IN ('n', 'c')`,
        [TABLE],
      )
    ).rows;

    // Everything but the indexes, which are built after the rows are in (and
    // the trigger, which LIKE never copies: the rows bring their geometry_3857).
    await client.query(`CREATE TABLE ${COPY} (LIKE ${TABLE} INCLUDING ALL EXCLUDING INDEXES)`);
    const copied = await step("Copying the parts in spatial order", () =>
      client.query(
        `INSERT INTO ${COPY}
         SELECT * FROM ${TABLE}
         ORDER BY ST_GeoHash(ST_Centroid(geometry)), id`,
      ),
    );
    const original = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${TABLE}`,
    );
    if (copied.rowCount !== original.rows[0].count) {
      throw new Error(`Copied ${copied.rowCount} parts of ${original.rows[0].count}`);
    }
    console.log(`  ${copied.rowCount} parts`);

    const tablePrefix = new RegExp(`^(CREATE (?:UNIQUE )?INDEX) (\\S+) ON (\\S+\\.)?${TABLE} `);
    for (const index of indexes) {
      const match = tablePrefix.exec(index.definition);
      if (!match || match[2] !== index.name) {
        throw new Error(`Can't retarget index ${index.name}: ${index.definition}`);
      }
      const definition = index.definition.replace(
        tablePrefix,
        `$1 ${index.name}_reordered ON $3${COPY} `,
      );
      await step(`Building ${index.name}`, () => client.query(definition));
    }
    await step("Analysing the copy", () => client.query(`ANALYZE ${COPY}`));

    await step("Swapping it in", async () => {
      await client.query(`DROP TABLE ${TABLE}`);
      await client.query(`ALTER TABLE ${COPY} RENAME TO ${TABLE}`);
      for (const index of indexes) {
        await client.query(
          index.primary
            ? `ALTER TABLE ${TABLE} ADD CONSTRAINT ${index.name} PRIMARY KEY USING INDEX ${index.name}_reordered`
            : `ALTER INDEX ${index.name}_reordered RENAME TO ${index.name}`,
        );
      }
      for (const trigger of triggers) {
        await client.query(trigger.definition);
      }
      // LIKE names the copied constraints after the copy's table.
      const copiedConstraints = await client.query<{ name: string; definition: string }>(
        `SELECT conname AS name, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint WHERE conrelid = $1::regclass AND contype IN ('n', 'c')`,
        [TABLE],
      );
      for (const constraint of copiedConstraints.rows) {
        const before = constraints.find((c) => c.definition === constraint.definition);
        if (before && before.name !== constraint.name) {
          await client.query(
            `ALTER TABLE ${TABLE} RENAME CONSTRAINT ${constraint.name} TO ${before.name}`,
          );
        }
      }
    });

    await client.query("COMMIT");

    // Outside the transaction: sets the visibility map, so the first reads don't
    // write hint bits across the whole table, and freezes it, so an
    // anti-wraparound vacuum never has to rewrite it later.
    await step("Vacuuming", () => client.query(`VACUUM (FREEZE, ANALYZE) ${TABLE}`));
    console.log(`After: ${await tableSize(client, TABLE)}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

reorderRailwayParts().catch((error) => {
  console.error("\nReordering failed, nothing changed:", error);
  process.exit(1);
});
