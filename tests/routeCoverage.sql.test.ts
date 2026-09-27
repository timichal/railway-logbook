/**
 * `isRouteFullyRidden` against the SQL function `user_fully_ridden_routes`: the
 * same rule written twice (see `routeCoverage.ts`), so the one thing worth
 * testing is that they agree.
 *
 * Needs the local database with `02-vector-tiles.sql` applied; skipped when it
 * cannot be reached. Nothing is written to the real tables: the function names
 * its tables unqualified, and a temporary table of the same name comes first on
 * the search path, so it reads the cases from temp tables created — and dropped
 * — inside one rolled-back transaction.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import dotenv from "dotenv";
import { Client } from "pg";
import { getDbConfig } from "@/lib/dbConfig";
import { isRouteFullyRidden, type RiddenPart } from "@/lib/shared/routeCoverage";

interface Case {
  trackId: number;
  lengthKm: number;
  parts: RiddenPart[];
}

/** A user id no real account can have, so a missed temp table reads nothing. */
const USER_ID = -1;

/** Seeded, so a failing case comes back on the next run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const stretch = (covered_start: number, covered_end: number): RiddenPart => ({
  partial: true,
  covered_start,
  covered_end,
});
const unknown: RiddenPart = { partial: true, covered_start: null, covered_end: null };

const handPicked: Omit<Case, "trackId">[] = [
  { lengthKm: 10, parts: [{ partial: false }] },
  { lengthKm: 10, parts: [unknown] },
  { lengthKm: 10, parts: [unknown, stretch(0, 0.5)] },
  { lengthKm: 10, parts: [stretch(0.5, 1), stretch(0, 0.5)] },
  { lengthKm: 10, parts: [stretch(0.02, 0.99)] },
  { lengthKm: 10, parts: [stretch(0.04, 1)] },
  { lengthKm: 10, parts: [stretch(0, 0.5), stretch(0.55, 1)] },
  { lengthKm: 10, parts: [stretch(0, 0.5), stretch(0.61, 1)] },
  { lengthKm: 0.5, parts: [stretch(0.25, 0.75)] },
  { lengthKm: 0.5, parts: [stretch(0.26, 0.75)] },
  { lengthKm: 0, parts: [stretch(0, 1)] },
  { lengthKm: 0, parts: [stretch(0.001, 1)] },
  { lengthKm: 250, parts: [stretch(0.6, 1), stretch(0.1, 0.2), stretch(0, 0.7)] },
];

function randomCases(count: number): Omit<Case, "trackId">[] {
  const random = mulberry32(20260928);
  const lengths = [0, 0.3, 0.8, 1.2, 4, 12, 60, 300];

  return Array.from({ length: count }, () => {
    const lengthKm =
      random() < 0.5 ? lengths[Math.floor(random() * lengths.length)] : random() * 40;
    const parts: RiddenPart[] = [];
    let lastEnd = 0;

    for (let n = 1 + Math.floor(random() * 5); n > 0; n--) {
      const kind = random();
      if (kind < 0.05) {
        parts.push({ partial: false });
      } else if (kind < 0.15) {
        parts.push(unknown);
      } else {
        // Sometimes pick up exactly where the last stretch ended (a shared
        // station), sometimes at a terminus, otherwise anywhere
        const pick = random();
        const start = pick < 0.3 ? lastEnd : pick < 0.45 ? 0 : random() * 0.95;
        const end = random() < 0.2 ? 1 : start + (1 - start) * (0.05 + random() * 0.95);
        if (start >= end || start >= 1) continue;
        parts.push(stretch(start, end));
        lastEnd = end;
      }
    }
    return { lengthKm, parts };
  });
}

async function connect(): Promise<Client | null> {
  dotenv.config({ quiet: true });
  const client = new Client({ ...getDbConfig(), connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

test("isRouteFullyRidden agrees with the SQL user_fully_ridden_routes", async (t) => {
  const client = await connect();
  if (!client) {
    t.skip("database not reachable");
    return;
  }

  const cases: Case[] = [...handPicked, ...randomCases(2000)].map((c, i) => ({
    ...c,
    trackId: i + 1,
  }));

  try {
    await client.query("BEGIN");
    await client.query(
      "CREATE TEMP TABLE railway_routes (track_id integer, length_km numeric) ON COMMIT DROP",
    );
    await client.query(
      `CREATE TEMP TABLE user_logged_parts (
         user_id integer, track_id integer, partial boolean,
         covered_start double precision, covered_end double precision
       ) ON COMMIT DROP`,
    );

    await client.query(
      "INSERT INTO railway_routes SELECT * FROM unnest($1::integer[], $2::numeric[])",
      [cases.map((c) => c.trackId), cases.map((c) => c.lengthKm)],
    );
    const rows = cases.flatMap((c) => c.parts.map((part) => ({ trackId: c.trackId, part })));
    await client.query(
      `INSERT INTO user_logged_parts
       SELECT $1, * FROM unnest($2::integer[], $3::boolean[], $4::float8[], $5::float8[])`,
      [
        USER_ID,
        rows.map((r) => r.trackId),
        rows.map((r) => r.part.partial),
        rows.map((r) => r.part.covered_start ?? null),
        rows.map((r) => r.part.covered_end ?? null),
      ],
    );

    const { rows: ridden } = await client.query<{ track_id: number }>(
      "SELECT track_id FROM user_fully_ridden_routes($1)",
      [USER_ID],
    );
    const sqlRidden = new Set(ridden.map((row) => row.track_id));

    const disagreements = cases
      .filter((c) => isRouteFullyRidden(c.parts, c.lengthKm) !== sqlRidden.has(c.trackId))
      .map((c) => ({ ...c, sql: sqlRidden.has(c.trackId) }));
    assert.deepEqual(disagreements, []);

    // Both answers are exercised, or agreement would say little
    assert.ok(sqlRidden.size > cases.length * 0.1, `${sqlRidden.size} of ${cases.length} ridden`);
    assert.ok(sqlRidden.size < cases.length * 0.9, `${sqlRidden.size} of ${cases.length} ridden`);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
