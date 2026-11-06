/**
 * The route network loaded from the database, and kept in memory between
 * searches while it stays the same.
 */

import pool from "../db";
import { ordinaryRouteSql } from "../shared/regions";
import {
  buildRouteGraph,
  type NetworkRoute,
  type PlannerOptions,
  type RouteNetwork,
} from "./routeGraph";

/**
 * The SQL condition for the routes a search with these options may ride (see
 * `PlannerOptions`): Regular, plus whatever else the route's own region counts as
 * ordinary, and closed routes only when asked. Shared with the station matching,
 * which must not find a route the graph does not hold.
 */
export function plannerRouteSql(alias: "r", options: PlannerOptions): string {
  const usage = options.includeSpecial ? ordinaryRouteSql(alias) : `${alias}.usage_type = 0`;
  return options.includeClosed ? usage : `(${usage} AND NOT ${alias}.closed)`;
}

/** A loaded route, with what decides which networks hold it. */
interface LoadedRoute {
  route: NetworkRoute;
  usageType: number;
  closed: boolean;
}

/**
 * Every network a search can ask for, from one load: the Regular routes alone or
 * with the non-Regular ones their region counts as ordinary, each without or
 * with the closed lines (`PlannerOptions`). One query, since reading the
 * endpoints is the expensive part and every network is a subset of what it
 * loads. A network's graph is built when a search first asks for it, so a day
 * of Europe-only searches over open lines builds one.
 */
interface CachedRouteNetworks {
  /** Network fingerprint the graphs were built from — see getNetworkSignature. */
  signature: string;
  /** Every loaded route, in load order (the graph breaks cost ties in it). */
  routes: LoadedRoute[];
  /** The networks built so far, by `networkKey`. */
  built: Map<string, RouteNetwork>;
}

function networkKey(options: PlannerOptions): string {
  return `${options.includeSpecial === true}/${options.includeClosed === true}`;
}

function networkOf(routes: LoadedRoute[], options: PlannerOptions): RouteNetwork {
  const routeInfo = new Map<number, NetworkRoute>();
  for (const { route, usageType, closed } of routes) {
    if (usageType !== 0 && !options.includeSpecial) continue;
    if (closed && !options.includeClosed) continue;
    routeInfo.set(route.track_id, route);
  }
  return { graph: buildRouteGraph(routeInfo), routeInfo };
}

/**
 * Load every route a search can ride — each one its region counts as ordinary
 * service, closed ones included (see `buildRouteGraph`).
 *
 * The network is small enough (a few thousand routes, endpoints only) to load in
 * one query, so there is no buffering around the stations: pathfinding used to
 * retry with 50km/100km/.../1000km buffers, re-querying and rebuilding the graph
 * each time a segment failed.
 */
async function loadRouteNetworks(signature: string): Promise<CachedRouteNetworks> {
  const client = await pool.connect();
  const routes: LoadedRoute[] = [];

  try {
    const result = await client.query<{
      track_id: number;
      usage_type: number;
      closed: boolean;
      length_km: number;
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
        r.usage_type,
        r.closed,
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
      WHERE ${ordinaryRouteSql("r")}
        AND ST_NPoints(r.geometry) >= 2
      `,
    );

    for (const row of result.rows) {
      const route: NetworkRoute = {
        track_id: row.track_id,
        length_km: row.length_km,
        line_class: row.line_class,
        startCoord: [row.start_x, row.start_y],
        nearStartCoord: [row.near_start_x, row.near_start_y],
        nearEndCoord: [row.near_end_x, row.near_end_y],
        endCoord: [row.end_x, row.end_y],
      };
      routes.push({ route, usageType: row.usage_type, closed: row.closed });
    }

    return { signature, routes, built: new Map() };
  } finally {
    client.release();
  }
}

let cachedNetwork: CachedRouteNetworks | null = null;
let networkInFlight: { signature: string; promise: Promise<CachedRouteNetworks> } | null = null;

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
    SELECT count(*) AS total, sum(xmin::text::bigint)::text AS xmins
    FROM railway_routes
    `,
  );
  const row = result.rows[0];
  return `${row.total}/${row.xmins ?? "-"}`;
}

/**
 * The network a search with these options rides (see `PlannerOptions`), for the
 * current state of `railway_routes`, reused across requests.
 *
 * Extracting endpoint coordinates costs ~450ms because every ST_PointN has to
 * walk the full linestring, so the loaded routes and the graphs built from them
 * are kept in memory and only reloaded when the network fingerprint changes.
 */
export async function getRouteNetwork(options: PlannerOptions = {}): Promise<RouteNetwork> {
  const networks = await getRouteNetworks();
  const key = networkKey(options);
  let network = networks.built.get(key);
  if (!network) {
    network = networkOf(networks.routes, options);
    networks.built.set(key, network);
  }
  return network;
}

async function getRouteNetworks(): Promise<CachedRouteNetworks> {
  const signature = await getNetworkSignature();
  if (cachedNetwork?.signature === signature) return cachedNetwork;

  // Concurrent searches share one rebuild, as long as they want the same network
  if (networkInFlight?.signature !== signature) {
    networkInFlight = { signature, promise: loadRouteNetworks(signature) };
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
