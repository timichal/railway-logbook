/**
 * "Have the routes changed": what an in-memory cache of anything read from
 * `railway_routes` is keyed on (the planner's route network, the route details).
 */

import pool from "./db";

/**
 * Cheap fingerprint of `railway_routes`: the row count and the sum of every
 * row's `xmin`, the id of the transaction that last wrote it.
 *
 * An insert or update gives its row a new `xmin` and a delete moves the count,
 * so any committed write changes the fingerprint — whatever the write path, and
 * whichever order concurrent writes commit in. `max(updated_at)`, the previous
 * fingerprint, had neither property: it relied on every write path setting the
 * column, and a timestamp is taken when a transaction starts, so an admin save
 * committing after a later-started `verifyRouteData` update left the maximum
 * where it was and the cache stale. (Freezing can rewrite an old row's `xmin`,
 * which costs one needless rebuild and nothing else.)
 *
 * It scans the heap (~5–7ms), so it is asked once per request, not per use.
 */
export async function routesFingerprint(): Promise<string> {
  const result = await pool.query<{ total: string; xmins: string | null }>(
    `
    SELECT count(*) AS total, sum(xmin::text::bigint)::text AS xmins
    FROM railway_routes
    `,
  );
  const row = result.rows[0];
  return `${row.total}/${row.xmins ?? "-"}`;
}
