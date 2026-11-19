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
 * Also checks the word breaks of `search_words` (what the multi-word search
 * matches word by word) against `SEARCH_WORD_BREAKS`, the word-prefix patterns on
 * a few names, and that the folds stored on stations (`name_key`, `name_words`)
 * are still what the functions give.
 *
 * Needs the local database with `02-vector-tiles.sql` applied; skipped when it
 * cannot be reached. Only reads.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";
import { dbConfig } from "@/lib/dbConfig";
import { SEARCH_WORD_BREAKS } from "@/lib/shared/searchQuery";
import { foldForSearch } from "@/lib/shared/searchText";

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

// stations.name_key stores search_key(name). 02-vector-tiles.sql recomputes it
// when the folding functions change; a stored key that no longer matches the
// function means that step was missed, and the station search misses names.
test("stations.name_key is search_key(name)", async (t) => {
  const client = await connect();
  if (!client) {
    t.skip("database not reachable");
    return;
  }

  try {
    const { rows } = await client.query<{ name: string; stored: string; key: string }>(
      `SELECT name, name_key AS stored, search_key(name) AS key
       FROM stations
       WHERE name_key IS DISTINCT FROM search_key(name)
       LIMIT 10`,
    );
    assert.deepEqual(rows, []);
  } finally {
    await client.end();
  }
});

// Every character of the hand-picked separator strings parts two words in SQL
// exactly when the query side splits on it, or "a-b" and the name "A-B" would
// fall into different words.
test("search_words breaks words where SEARCH_WORD_BREAKS splits a query", async (t) => {
  const client = await connect();
  if (!client) {
    t.skip("database not reachable");
    return;
  }

  try {
    const separators = [...new Set(handPicked.slice(-2).join(""))].filter(
      (char) => !/[\p{L}\p{N}]/u.test(char),
    );
    const { rows } = await client.query<{ char: string; words: string }>(
      `SELECT char, search_words('a' || char || 'b') AS words FROM unnest($1::text[]) AS char`,
      [separators],
    );
    const disagreements = rows
      .map((row) => ({ ...row, expected: SEARCH_WORD_BREAKS.test(row.char) ? " a b" : " ab" }))
      .filter((row) => row.words !== row.expected);
    assert.deepEqual(disagreements, []);
  } finally {
    await client.end();
  }
});

test("word-prefix patterns find words after brackets, slashes and a leading separator", async (t) => {
  const client = await connect();
  if (!client) {
    t.skip("database not reachable");
    return;
  }

  // [name, the query's pattern (wordPrefixPattern), matched from the first word,
  // matched from any word], as searchStationsByName compares them
  const cases: [name: string, pattern: string, atStart: boolean, anywhere: boolean][] = [
    ["Praha-Dejvice", " pr% de%", true, true],
    ["Praha-Dejvice", " de% pr%", false, false],
    ["Prdel", " pr% de%", false, false],
    ["Les Praz-de-Chamonix", " pr% de%", false, true],
    ["Frankfurt (Main) Hbf", " fr% ma%", true, true],
    ["Halle/Saale", " ha% sa%", true, true],
    ["Hachiman-Ōhashi（Tōryō High School)", " ha% to%", true, true],
    [" ・Praha hlavní nádraží", " pr% hl%", true, true],
    ["San'yō Main Line", " sanyo% ma%", true, true],
    ["San'yō Main Line", " san% yo%", false, false],
  ];
  try {
    const { rows } = await client.query<{
      name: string;
      pattern: string;
      at_start: boolean;
      anywhere: boolean;
    }>(
      `SELECT name, pattern,
              search_words(name) LIKE search_words(pattern) AS at_start,
              search_words(name) LIKE '%' || search_words(pattern) AS anywhere
       FROM unnest($1::text[], $2::text[]) AS c(name, pattern)`,
      [cases.map((c) => c[0]), cases.map((c) => c[1])],
    );
    assert.deepEqual(
      rows.map((row) => [row.name, row.pattern, row.at_start, row.anywhere]),
      cases,
    );
  } finally {
    await client.end();
  }
});

// stations.name_words stores search_words(name), recomputed like name_key.
test("stations.name_words is search_words(name)", async (t) => {
  const client = await connect();
  if (!client) {
    t.skip("database not reachable");
    return;
  }

  try {
    const { rows } = await client.query<{ name: string; stored: string; words: string }>(
      `SELECT name, name_words AS stored, search_words(name) AS words
       FROM stations
       WHERE name_words IS DISTINCT FROM search_words(name)
       LIMIT 10`,
    );
    assert.deepEqual(rows, []);
  } finally {
    await client.end();
  }
});
