/**
 * The logbook's search (`journeysAndTripsForUser`, behind My Trips and
 * `GET /api/v1/logbook`). A trip is found by its own name and description, or by
 * any journey filed under it, since that is where the journey is listed; a
 * standalone journey by its name, description or date.
 *
 * Writes a throwaway account with a trip and journeys (no routes, so they belong
 * to every region) and deletes it afterwards, which cascades. Needs the local
 * database; skipped when it cannot be reached.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Client } from "pg";
import pool from "@/lib/db";
import { dbConfig } from "@/lib/dbConfig";
import { journeysAndTripsForUser } from "@/lib/tripQueries";

after(() => pool.end());

async function reachable(): Promise<boolean> {
  const client = new Client({ ...dbConfig, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

test("a trip is found by the journeys filed under it", async (t) => {
  if (!(await reachable())) {
    t.skip("database not reachable");
    return;
  }

  const email = `logbook-search-${Date.now()}-${process.pid}@example.test`;
  const user = await pool.query<{ id: number }>(
    "INSERT INTO users (email, name) VALUES ($1, 'search test') RETURNING id",
    [email],
  );
  const userId = user.rows[0].id;

  try {
    const trip = await pool.query<{ id: number }>(
      "INSERT INTO user_trips (user_id, name) VALUES ($1, 'Scandinavia') RETURNING id",
      [userId],
    );
    const tripId = trip.rows[0].id;
    await pool.query(
      `INSERT INTO user_journeys (user_id, name, description, date, trip_id) VALUES
         ($1, 'Praha Helsingborg', 'night train', '2026-05-19', $2),
         ($1, 'Helsingborg Bergen', NULL, '2026-05-20', $2),
         ($1, 'Brno Wien', NULL, '2026-06-01', NULL)`,
      [userId, tripId],
    );

    const search = async (query: string) => {
      const { items, total } = await journeysAndTripsForUser(userId, 1, 10, query, "europe");
      assert.equal(total, items.length);
      return items.map((item) =>
        item.type === "trip"
          ? `trip:${item.trip.name}:${item.journeys.length}`
          : `journey:${item.journey.name}`,
      );
    };

    // The whole trip, with every journey in it, not only the one that matched
    assert.deepEqual(await search("praha helsingborg"), ["trip:Scandinavia:2"]);
    assert.deepEqual(await search("night train"), ["trip:Scandinavia:2"]);
    assert.deepEqual(await search("2026-05-20"), ["trip:Scandinavia:2"]);
    assert.deepEqual(await search("scandinavia"), ["trip:Scandinavia:2"]);
    // Ordered by date, newest first: the standalone journey, then the trip
    assert.deepEqual(await search("2026"), ["journey:Brno Wien", "trip:Scandinavia:2"]);
    assert.deepEqual(await search("brno"), ["journey:Brno Wien"]);
    assert.deepEqual(await search("budapest"), []);
  } finally {
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }
});
