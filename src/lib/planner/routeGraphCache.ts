/**
 * The route network loaded from the database, and kept in memory between
 * searches while it stays the same.
 */

import pool from "../db";
import { buildRouteGraph, type NetworkRoute, type RouteNetwork } from "./routeGraph";

interface CachedRouteNetwork extends RouteNetwork {
  /** Network fingerprint the graph was built from — see getNetworkSignature. */
  signature: string;
}

/**
 * Load the whole regular-usage route network and connect routes whose endpoints
 * meet (see `buildRouteGraph`).
 *
 * The network is small enough (a few thousand routes, endpoints only) to load in
 * one query, so there is no buffering around the stations: pathfinding used to
 * retry with 50km/100km/.../1000km buffers, re-querying and rebuilding the graph
 * each time a segment failed.
 */
async function loadRouteNetwork(signature: string): Promise<CachedRouteNetwork> {
  const client = await pool.connect();
  const routeInfo = new Map<number, NetworkRoute>();

  try {
    const result = await client.query<{
      track_id: number;
      length_km: string | number;
      line_class: string | null;
      start_x: number;
      start_y: number;
      near_start_x: number;
      near_start_y: number;
      near_end_x: number;
      near_end_y: number;
      end_x: number;
      end_y: number;
    }>(
      `
      SELECT
        r.track_id,
        r.length_km,
        r.line_class,
        ST_X(ST_PointN(r.geometry, 1)) as start_x,
        ST_Y(ST_PointN(r.geometry, 1)) as start_y,
        ST_X(ST_PointN(r.geometry, 2)) as near_start_x,
        ST_Y(ST_PointN(r.geometry, 2)) as near_start_y,
        ST_X(ST_PointN(r.geometry, GREATEST(ST_NPoints(r.geometry) - 1, 1))) as near_end_x,
        ST_Y(ST_PointN(r.geometry, GREATEST(ST_NPoints(r.geometry) - 1, 1))) as near_end_y,
        ST_X(ST_PointN(r.geometry, ST_NPoints(r.geometry))) as end_x,
        ST_Y(ST_PointN(r.geometry, ST_NPoints(r.geometry))) as end_y
      FROM railway_routes r
      WHERE r.usage_type = 0
        AND ST_NPoints(r.geometry) >= 2
      `,
    );

    for (const row of result.rows) {
      const lengthKm =
        typeof row.length_km === "string" ? parseFloat(row.length_km) : row.length_km;
      routeInfo.set(row.track_id, {
        track_id: row.track_id,
        length_km: lengthKm,
        line_class: row.line_class,
        startCoord: [row.start_x, row.start_y],
        nearStartCoord: [row.near_start_x, row.near_start_y],
        nearEndCoord: [row.near_end_x, row.near_end_y],
        endCoord: [row.end_x, row.end_y],
      });
    }

    return { graph: buildRouteGraph(routeInfo), routeInfo, signature };
  } finally {
    client.release();
  }
}

let cachedNetwork: CachedRouteNetwork | null = null;
let networkInFlight: { signature: string; promise: Promise<CachedRouteNetwork> } | null = null;

/**
 * Cheap fingerprint of the route network: the row count and the sum of every
 * row's `xmin`, the id of the transaction that last wrote it.
 *
 * An insert or update gives its row a new `xmin` and a delete moves the count,
 * so any committed write changes the signature — whatever the write path, and
 * whichever order concurrent writes commit in. `max(updated_at)`, the previous
 * fingerprint, had neither property: it relied on every write path setting the
 * column, and a timestamp is taken when a transaction starts, so an admin save
 * committing after a later-started `verifyRouteData` update left the maximum
 * where it was and the cache stale. (Freezing can rewrite an old row's `xmin`,
 * which costs one needless rebuild and nothing else.)
 */
async function getNetworkSignature(): Promise<string> {
  const result = await pool.query<{ total: string; xmins: string | null }>(
    `
    SELECT count(*) AS total, sum(xmin::text::bigint) AS xmins
    FROM railway_routes
    `,
  );
  const row = result.rows[0];
  return `${row.total}/${row.xmins ?? "-"}`;
}

/**
 * Route network for the current state of `railway_routes`, reused across
 * requests.
 *
 * Extracting endpoint coordinates costs ~450ms because every ST_PointN has to
 * walk the full linestring, so the built graph is kept in memory and only
 * rebuilt when the network fingerprint changes.
 */
export async function getRouteNetwork(): Promise<RouteNetwork> {
  const signature = await getNetworkSignature();
  if (cachedNetwork?.signature === signature) return cachedNetwork;

  // Concurrent searches share one rebuild, as long as they want the same network
  if (networkInFlight?.signature !== signature) {
    networkInFlight = { signature, promise: loadRouteNetwork(signature) };
  }

  const pending = networkInFlight;
  try {
    const network = await pending.promise;
    // A load for an older signature can finish after a newer one has already
    // been cached (two searches straddling a write); it answers its own caller
    // but must not put the older graph back
    if (networkInFlight === pending || cachedNetwork === null) cachedNetwork = network;
    return network;
  } finally {
    if (networkInFlight === pending) networkInFlight = null;
  }
}
