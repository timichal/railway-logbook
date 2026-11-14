/**
 * "Have the routes changed": what an in-memory cache of anything read from
 * `railway_routes` is keyed on (the planner's route network, and the public
 * answers `routesCachedJson` keeps: route details, summaries, track ids).
 */

import pool from "./db";

/**
 * The `railway_routes` row of `data_versions`, a counter that a deferred trigger
 * moves at the commit of every transaction that writes the table, so it changes
 * exactly when a committed write does, whatever the write path and whichever
 * order concurrent writes commit in. Deferred on purpose: a mid-transaction bump
 * deadlocks (the comment above `bump_data_version` in `01-schema.sql`).
 *
 * `max(updated_at)`, an earlier fingerprint, relied on every write path setting
 * the column, and a timestamp is taken when a transaction starts, so an admin
 * save committing after a later-started `verifyRouteData` update left the
 * maximum where it was and the cache stale. `count(*)` + `sum(xmin)`, the next
 * one, was right but scanned the heap (~5–7ms) on every request.
 */
export async function routesFingerprint(): Promise<string> {
  const result = await pool.query<{ version: string }>(
    "SELECT version::text FROM data_versions WHERE table_name = 'railway_routes'",
  );
  const version = result.rows[0]?.version;
  // The row is seeded by 01-schema.sql (or the addDataVersions migration);
  // without it nothing would ever invalidate, so fail loudly rather than cache
  // forever
  if (version === undefined) throw new Error("data_versions has no railway_routes row");
  return version;
}
