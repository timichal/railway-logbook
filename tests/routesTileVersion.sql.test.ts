/**
 * The route tile's version (`routesTileVersion.ts`). The route tiles are served
 * `immutable` under it, so a change to the tile that leaves it where it was is
 * held by every browser for a year, with nothing else failing.
 *
 * Each case runs in a transaction that is rolled back, so nothing is written
 * (`CREATE OR REPLACE FUNCTION` included).
 *
 * Needs the local database and at least one route; skipped when it cannot be
 * reached.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { dbConfig } from "@/lib/dbConfig";
import {
  ROUTES_TILE_INPUTS_SQL,
  type RoutesTileInputs,
  routesTileVersionFrom,
} from "@/lib/routesTileVersion";

const SECRET = new TextEncoder().encode("test secret, at least thirty-two bytes long");

async function connect(): Promise<Client | null> {
  const client = new Client({ ...dbConfig, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

async function currentVersion(client: Client): Promise<string> {
  const { rows } = await client.query<RoutesTileInputs>(ROUTES_TILE_INPUTS_SQL);
  assert.equal(rows.length, 1, "data_versions has its railway_routes row");
  assert.ok(rows[0].functions, "the tile functions exist");
  return routesTileVersionFrom(rows[0], SECRET);
}

async function inRolledBackTransaction(
  t: { skip: (message: string) => void },
  body: (client: Client) => Promise<void>,
): Promise<void> {
  const client = await connect();
  if (!client) {
    t.skip("database unavailable");
    return;
  }
  try {
    await client.query("BEGIN");
    await body(client);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
}

test("the tile version moves at the commit of a route write", async (t) => {
  await inRolledBackTransaction(t, async (client) => {
    const before = await currentVersion(client);
    assert.equal(await currentVersion(client), before, "stable while nothing changes");
    const { rowCount } = await client.query(
      "UPDATE railway_routes SET usage_tags = usage_tags WHERE track_id = (SELECT min(track_id) FROM railway_routes)",
    );
    if (rowCount === 0) {
      t.skip("no routes");
      return;
    }
    await client.query("SET CONSTRAINTS railway_routes_bump_version IMMEDIATE");
    assert.notEqual(await currentVersion(client), before);
  });
});

test("the tile version moves when the SQL drawing the tile changes", async (t) => {
  await inRolledBackTransaction(t, async (client) => {
    const before = await currentVersion(client);
    // The same value, written differently: what counts is the definition
    await client.query(
      "CREATE OR REPLACE FUNCTION tile_unit(z integer) RETURNS float8 LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT RETURN 40075016.68 / (4096 * power(2, z))",
    );
    assert.notEqual(await currentVersion(client), before);
  });
});

test("the tile version can't be worked out without the secret", () => {
  const inputs = { version: "1", functions: "abc" };
  const other = new TextEncoder().encode("another secret, at least thirty-two bytes");
  assert.match(routesTileVersionFrom(inputs, SECRET), /^[0-9a-f]{16}$/);
  assert.notEqual(routesTileVersionFrom(inputs, SECRET), routesTileVersionFrom(inputs, other));
  assert.notEqual(
    routesTileVersionFrom(inputs, SECRET),
    routesTileVersionFrom({ ...inputs, version: "2" }, SECRET),
  );
});
