'use server';

import pool from './db';

interface RouteNode {
  track_id: number;
  description: string;
  length_km: number;
}

interface RouteConnection {
  from_route: number;
  to_route: number;
  distance_m: number;
}

interface PathResult {
  routes: RouteNode[];
  totalDistance: number;
  error?: string;
}

const STATION_TO_ROUTE_TOLERANCE_M = 2000; // Station can be 2000m from route
const ROUTE_CONNECTION_TOLERANCE_M = 500; // Route endpoints can be 500m apart

/**
 * Find all routes that pass near a given station
 */
async function findRoutesNearStation(stationId: number): Promise<number[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ track_id: number }>(
      `
      SELECT DISTINCT r.track_id
      FROM railway_routes r, stations s
      WHERE s.id = $1
        AND ST_DWithin(
          r.geometry::geography,
          s.coordinates::geography,
          $2
        )
      ORDER BY r.track_id
      `,
      [stationId, STATION_TO_ROUTE_TOLERANCE_M]
    );
    console.log(`[findRoutesNearStation] Station ${stationId}: found ${result.rows.length} routes`, result.rows.map(r => r.track_id));
    return result.rows.map(row => row.track_id);
  } finally {
    client.release();
  }
}

/**
 * Find neighboring routes for a given route (routes whose endpoints are close)
 */
async function findNeighboringRoutes(routeId: number): Promise<number[]> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ track_id: number }>(
      `
      WITH current_route AS (
        SELECT
          track_id,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM railway_routes
        WHERE track_id = $1
      ),
      other_routes AS (
        SELECT
          track_id,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM railway_routes
        WHERE track_id != $1
      )
      SELECT DISTINCT o.track_id
      FROM current_route c
      CROSS JOIN other_routes o
      WHERE (
        ST_DWithin(c.start_point::geography, o.start_point::geography, $2)
        OR ST_DWithin(c.start_point::geography, o.end_point::geography, $2)
        OR ST_DWithin(c.end_point::geography, o.start_point::geography, $2)
        OR ST_DWithin(c.end_point::geography, o.end_point::geography, $2)
      )
      `,
      [routeId, ROUTE_CONNECTION_TOLERANCE_M]
    );
    return result.rows.map(row => row.track_id);
  } finally {
    client.release();
  }
}

/**
 * BFS to find shortest path through route graph (with lazy neighbor discovery)
 */
async function findShortestPath(
  startRoutes: number[],
  endRoutes: number[],
  viaRouteSets: number[][]
): Promise<number[] | null> {
  if (startRoutes.length === 0 || endRoutes.length === 0) {
    return null;
  }

  const endSet = new Set(endRoutes);
  const queue: { route: number; path: number[]; viaIndex: number }[] = [];
  const visited = new Map<string, boolean>(); // Key: "route:viaIndex"

  // Initialize queue with start routes
  for (const route of startRoutes) {
    const key = `${route}:0`;
    queue.push({ route, path: [route], viaIndex: 0 });
    visited.set(key, true);
  }

  let iterations = 0;
  const maxIterations = 1000; // Safety limit

  while (queue.length > 0 && iterations < maxIterations) {
    iterations++;
    const current = queue.shift()!;

    // Check if we've passed through all required via stations
    const allViaPassed = current.viaIndex >= viaRouteSets.length;

    // Check if we reached the end
    if (endSet.has(current.route) && allViaPassed) {
      console.log(`[findShortestPath] Found path after ${iterations} iterations`);
      return current.path;
    }

    // Get next via routes to check (if any)
    const nextViaRoutes = current.viaIndex < viaRouteSets.length
      ? new Set(viaRouteSets[current.viaIndex])
      : null;

    // Find neighbors for this route (lazy discovery)
    const neighbors = await findNeighboringRoutes(current.route);

    for (const neighbor of neighbors) {
      // Check if this neighbor passes through the next via station
      let newViaIndex = current.viaIndex;
      if (nextViaRoutes && nextViaRoutes.has(neighbor)) {
        newViaIndex = current.viaIndex + 1;
      }

      const key = `${neighbor}:${newViaIndex}`;
      if (!visited.get(key)) {
        visited.set(key, true);
        queue.push({
          route: neighbor,
          path: [...current.path, neighbor],
          viaIndex: newViaIndex
        });
      }
    }
  }

  console.log(`[findShortestPath] No path found after ${iterations} iterations`);
  return null; // No path found
}

/**
 * Get route details for a list of route IDs
 */
async function getRouteDetails(routeIds: number[]): Promise<RouteNode[]> {
  if (routeIds.length === 0) return [];

  const client = await pool.connect();
  try {
    const result = await client.query<{ track_id: number; description: string; length_km: string | number }>(
      `
      SELECT track_id, description, length_km
      FROM railway_routes
      WHERE track_id = ANY($1)
      ORDER BY array_position($1, track_id)
      `,
      [routeIds]
    );
    // Convert length_km to number (PostgreSQL returns it as string)
    return result.rows.map(row => ({
      track_id: row.track_id,
      description: row.description,
      length_km: typeof row.length_km === 'string' ? parseFloat(row.length_km) : row.length_km
    }));
  } finally {
    client.release();
  }
}

/**
 * Find the shortest path of routes connecting from -> via -> to stations
 */
export async function findRoutePathBetweenStations(
  fromStationId: number,
  toStationId: number,
  viaStationIds: number[] = []
): Promise<PathResult> {
  try {
    console.log('[RoutePathFinder] Finding path from station', fromStationId, 'to station', toStationId);

    // Find routes near each station
    const fromRoutes = await findRoutesNearStation(fromStationId);
    const toRoutes = await findRoutesNearStation(toStationId);
    const viaRouteSets = await Promise.all(
      viaStationIds.map(id => findRoutesNearStation(id))
    );

    console.log('[RoutePathFinder] Routes near from station:', fromRoutes);
    console.log('[RoutePathFinder] Routes near to station:', toRoutes);
    console.log('[RoutePathFinder] Routes near via stations:', viaRouteSets);

    if (fromRoutes.length === 0) {
      return { routes: [], totalDistance: 0, error: 'No routes found near starting station' };
    }
    if (toRoutes.length === 0) {
      return { routes: [], totalDistance: 0, error: 'No routes found near ending station' };
    }
    for (let i = 0; i < viaRouteSets.length; i++) {
      if (viaRouteSets[i].length === 0) {
        return { routes: [], totalDistance: 0, error: `No routes found near via station ${i + 1}` };
      }
    }

    // Find shortest path using lazy neighbor discovery
    const path = await findShortestPath(fromRoutes, toRoutes, viaRouteSets);

    console.log('[RoutePathFinder] Found path:', path);

    if (!path) {
      return { routes: [], totalDistance: 0, error: 'No path found connecting the selected stations' };
    }

    // Get route details
    const routes = await getRouteDetails(path);
    const totalDistance = routes.reduce((sum, r) => sum + r.length_km, 0);

    return { routes, totalDistance };
  } catch (error) {
    console.error('Error finding route path:', error);
    return {
      routes: [],
      totalDistance: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
