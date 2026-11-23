/**
 * `countriesAt` (`src/lib/countryBoundaries.ts`): a route end's country comes
 * from `country_boundaries` where a boundary covers it, and from country-coder
 * only where none does.
 *
 * Runs in a transaction that is rolled back: the table is created where a
 * database predates it, emptied and given two made-up squares, so the answers
 * don't depend on whether the import was run. Then it is dropped, as on a
 * database the import never reached, where the admin saves must still work.
 * Vrbovce is the case the table exists for: country-coder puts it in CZ, OSM in
 * SK.
 *
 * Needs the local database; skipped when it cannot be reached.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { countriesAt } from "@/lib/countryBoundaries";
import { countryAt } from "@/lib/countryUtils";
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

const VRBOVCE: [number, number] = [17.5163, 48.82439];
const PRAGUE: [number, number] = [14.4378, 50.0755];
const NORTH_SEA: [number, number] = [3, 56];

test("countriesAt takes the boundary table first and country-coder where it has nothing", async (t) => {
  const client = await connect();
  if (!client) {
    t.skip("database not reachable");
    return;
  }

  try {
    assert.equal(
      countryAt(VRBOVCE),
      "CZ",
      "country-coder still misplaces Vrbovce (else pick another case)",
    );

    await client.query("BEGIN");
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS country_boundaries (
          code VARCHAR(2) NOT NULL, geometry GEOMETRY(POLYGON, 4326) NOT NULL
        )
      `);
      await client.query("DELETE FROM country_boundaries");
      // Two squares sharing the 17.6 meridian: SK west of it (over Vrbovce), CZ east
      await client.query(`
        INSERT INTO country_boundaries (code, geometry) VALUES
          ('SK', ST_MakeEnvelope(17.4, 48.7, 17.6, 48.9, 4326)),
          ('CZ', ST_MakeEnvelope(17.6, 48.7, 17.8, 48.9, 4326))
      `);

      assert.deepEqual(await countriesAt(client, []), []);
      assert.deepEqual(
        await countriesAt(client, [VRBOVCE, [17.7, 48.8], PRAGUE, NORTH_SEA]),
        ["SK", "CZ", countryAt(PRAGUE), null],
        "covered points from the table, in order; the rest from country-coder (null at sea)",
      );
      assert.deepEqual(
        await countriesAt(client, [[17.6, 48.8]]),
        ["CZ"],
        "a point on a shared border takes the first code alphabetically",
      );

      await client.query("DROP TABLE country_boundaries");
      assert.deepEqual(
        await countriesAt(client, [VRBOVCE, NORTH_SEA]),
        ["CZ", null],
        "with no table, country-coder answers everything (and the query doesn't fail)",
      );
    } finally {
      await client.query("ROLLBACK");
    }
  } finally {
    await client.end();
  }
});
