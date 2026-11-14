/**
 * The `data_versions` counter (`01-schema.sql`) that `routesFingerprint`
 * reads. Every in-memory cache of the routes (route details, summaries, track
 * ids, the planner's network) is keyed on it, so a bump that stops firing serves
 * stale routes forever with nothing else failing.
 *
 * Each case runs in a transaction that is rolled back, so nothing is written.
 * `SET CONSTRAINTS … IMMEDIATE` fires the deferred events queued so far, as a
 * commit would, which shows both that nothing moved before it and what moves
 * at it.
 *
 * Needs the local database and at least two routes; skipped when it cannot be
 * reached.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { dbConfig } from "@/lib/dbConfig";

async function connect(): Promise<Client | null> {
  const client = new Client({ ...dbConfig, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

async function version(client: Client): Promise<number> {
  const { rows } = await client.query<{ version: string }>(
    "SELECT version::text FROM data_versions WHERE table_name = 'railway_routes'",
  );
  assert.equal(rows.length, 1, "data_versions has its railway_routes row");
  return Number(rows[0].version);
}

/** Fires the deferred events queued in this transaction, as its commit would. */
async function fireDeferred(client: Client): Promise<void> {
  await client.query("SET CONSTRAINTS railway_routes_bump_version IMMEDIATE");
}

const touch = (trackIdSql: string) =>
  `UPDATE railway_routes SET usage_tags = usage_tags WHERE track_id = ${trackIdSql}`;
const FIRST = "(SELECT min(track_id) FROM railway_routes)";
const LAST = "(SELECT max(track_id) FROM railway_routes)";

test("data_versions moves once per writing transaction, at its commit", async (t) => {
  const client = await connect();
  if (!client) {
    t.skip("database not reachable");
    return;
  }

  try {
    const before = await version(client);

    await t.test("an update moves it at commit, not as it runs", async () => {
      await client.query("BEGIN");
      try {
        await client.query(touch(FIRST));
        assert.equal(await version(client), before, "not moved mid-transaction");
        await fireDeferred(client);
        assert.equal(await version(client), before + 1);
      } finally {
        await client.query("ROLLBACK");
      }
    });

    await t.test("several statements and rows move it once", async () => {
      await client.query("BEGIN");
      try {
        await client.query(touch(FIRST));
        await client.query(touch(LAST));
        await client.query(
          "UPDATE railway_routes SET usage_tags = usage_tags WHERE track_id IN (SELECT track_id FROM railway_routes ORDER BY track_id LIMIT 50)",
        );
        await fireDeferred(client);
        assert.equal(await version(client), before + 1);
        // Now immediate: a further write in the same transaction adds nothing
        await client.query(touch(LAST));
        assert.equal(await version(client), before + 1);
      } finally {
        await client.query("ROLLBACK");
      }
    });

    await t.test("a delete moves it", async () => {
      await client.query("BEGIN");
      try {
        await client.query(`DELETE FROM railway_routes WHERE track_id = ${LAST}`);
        await fireDeferred(client);
        assert.equal(await version(client), before + 1);
      } finally {
        await client.query("ROLLBACK");
      }
    });

    await t.test("a statement that touches no row moves nothing", async () => {
      await client.query("BEGIN");
      try {
        await client.query("UPDATE railway_routes SET usage_tags = usage_tags WHERE false");
        await fireDeferred(client);
        assert.equal(await version(client), before);
      } finally {
        await client.query("ROLLBACK");
      }
    });

    await t.test("a write rolled back leaves it where it was", async () => {
      assert.equal(await version(client), before);
    });
  } finally {
    await client.end();
  }
});
