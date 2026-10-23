/**
 * `foldForSearch` against the SQL function `search_key`: the same folding written
 * twice (see `searchText.ts`), the one on the lists filtered in the browser, the
 * other on the map's station and line search. Run over hand-picked names and
 * every name a route carries in the local database — line names, which both
 * fold, and the From/To the admin list folds — so a name that folds one way in
 * the admin list and another in the map search shows up here. Not over the OSM
 * station names, which only SQL folds: unaccent maps a few symbols NFKD leaves
 * alone („, 〈, ´), and nobody types those into a search box.
 *
 * Needs the local database with `02-vector-tiles.sql` applied; skipped when it
 * cannot be reached. Only reads.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { dbConfig } from "@/lib/dbConfig";
import { foldForSearch } from "@/lib/searchText";

const handPicked = [
  "Owari Seto",
  "Owari-Seto",
  "San'yō Main Line",
  "San’yō",
  "Honshi–Bisan Line",
  "Haneda Airport Terminal 1・2",
  "Narita Airport Terminal 2·3",
  "Shimin Hiroba (Convention Center)",
  "Futamatashimmachi [north junction]",
  "Łódź Fabryczna",
  "Straße",
  "Kırıkkale",
  "Þingvellir",
  "İzmir",
  "寺務所",
  "あざみの",
  "宮島ボートレース場",
  "３階のりば",
  "Hachiman-Ōhashi（Tōryō High School)",
  "№19",
  // Every whitespace JavaScript's \s knows, the no-break ones included
  "a\tb\nc\vd\fe\rf g\u00a0h\u1680i\u2000j\u2007k\u200al\u2028m\u2029n\u202fo\u205fp\u3000q\ufeffr",
  "a‐b‑c‒d–e—f―g-h'i’j‘kʼl.m·n・o",
];

async function connect(): Promise<Client | null> {
  const client = new Client({ ...dbConfig, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

test("foldForSearch agrees with the SQL search_key", async (t) => {
  const client = await connect();
  if (!client) {
    t.skip("database not reachable");
    return;
  }

  try {
    const { rows } = await client.query<{ name: string; key: string }>(
      `SELECT name, search_key(name) AS key
       FROM (
         SELECT unnest($1::text[]) AS name
         UNION SELECT name FROM railway_routes WHERE name IS NOT NULL
         UNION SELECT unnest(other_names) FROM railway_routes
         UNION SELECT from_station FROM railway_routes
         UNION SELECT to_station FROM railway_routes
       ) names`,
      [handPicked],
    );

    const disagreements = rows
      .filter((row) => foldForSearch(row.name) !== row.key)
      .map((row) => ({ name: row.name, js: foldForSearch(row.name), sql: row.key }));
    assert.deepEqual(disagreements, []);
  } finally {
    await client.end();
  }
});
