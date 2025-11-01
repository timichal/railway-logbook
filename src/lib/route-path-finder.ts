'use server';

import pool from './db';

interface RouteNode {
  track_id: number;
  from_station: string;
  to_station: string;
  description: string;
  length_km: number;
}

interface PathResult {
  routes: RouteNode[];
  totalDistance: number;
  error?: string;
}

const STATION_TO_ROUTE_TOLERANCE_M = 2000; // Station can be 2000m from route
const ROUTE_CONNECTION_TOLERANCE_M = 2000; // Route endpoints can be 2000m apart (increased from 500m)

/**
 * In-memory route graph for fast pathfinding
 */
class RouteGraph {
  private adjacencyList: Map<number, Set<number>> = new Map();

  addConnection(from: number, to: number) {
    if (!this.adjacencyList.has(from)) {
      this.adjacencyList.set(from, new Set());
    }
    this.adjacencyList.get(from)!.add(to);
  }

  getNeighbors(routeId: number): number[] {
    return Array.from(this.adjacencyList.get(routeId) || []);
  }

  clear() {
    this.adjacencyList.clear();
  }
}

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
    return result.rows.map(row => row.track_id);
  } finally {
    client.release();
  }
}

/**
 * Build route graph for routes within a buffer area around start/end stations
 */
async function buildRouteGraphInBuffer(
  fromStationId: number,
  toStationId: number,
  bufferMeters: number
): Promise<RouteGraph> {
  const client = await pool.connect();
  const graph = new RouteGraph();

  try {
    // Get all route connections within buffer area
    const result = await client.query<{ from_route: number; to_route: number }>(
      `
      WITH station_points AS (
        SELECT coordinates
        FROM stations
        WHERE id IN ($1, $2)
      ),
      search_area AS (
        SELECT ST_Transform(
          ST_Buffer(
            ST_Transform(ST_Collect(coordinates), 3857),
            $3
          ),
          4326
        ) as buffer_geom
        FROM station_points
      ),
      routes_in_area AS (
        SELECT DISTINCT r.track_id
        FROM railway_routes r, search_area
        WHERE ST_Intersects(r.geometry, search_area.buffer_geom)
      ),
      route_endpoints AS (
        SELECT
          track_id,
          ST_StartPoint(geometry) as start_point,
          ST_EndPoint(geometry) as end_point
        FROM railway_routes
        WHERE track_id IN (SELECT track_id FROM routes_in_area)
      )
      SELECT DISTINCT
        r1.track_id as from_route,
        r2.track_id as to_route
      FROM route_endpoints r1
      CROSS JOIN route_endpoints r2
      WHERE r1.track_id != r2.track_id
        AND (
          ST_DWithin(r1.start_point::geography, r2.start_point::geography, $4)
          OR ST_DWithin(r1.start_point::geography, r2.end_point::geography, $4)
          OR ST_DWithin(r1.end_point::geography, r2.start_point::geography, $4)
          OR ST_DWithin(r1.end_point::geography, r2.end_point::geography, $4)
        )
      `,
      [fromStationId, toStationId, bufferMeters, ROUTE_CONNECTION_TOLERANCE_M]
    );

    for (const row of result.rows) {
      graph.addConnection(row.from_route, row.to_route);
    }

    return graph;
  } finally {
    client.release();
  }
}

/**
 * BFS to find shortest path through route graph (in-memory)
 */
function findShortestPath(
  graph: RouteGraph,
  startRoutes: number[],
  endRoutes: number[]
): number[] | null {
  if (startRoutes.length === 0 || endRoutes.length === 0) {
    return null;
  }

  const endSet = new Set(endRoutes);
  const queue: { route: number; path: number[] }[] = [];
  const visited = new Set<number>();

  // Initialize queue with start routes
  for (const route of startRoutes) {
    queue.push({ route, path: [route] });
    visited.add(route);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Check if we reached the end
    if (endSet.has(current.route)) {
      return current.path;
    }

    // Explore neighbors
    const neighbors = graph.getNeighbors(current.route);
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({
          route: neighbor,
          path: [...current.path, neighbor],
        });
      }
    }
  }

  return null; // No path found
}

/**
 * Get route details for a list of route IDs
 */
async function getRouteDetails(routeIds: number[]): Promise<RouteNode[]> {
  if (routeIds.length === 0) return [];

  const client = await pool.connect();
  try {
    const result = await client.query<{
      track_id: number;
      from_station: string;
      to_station: string;
      description: string;
      length_km: string | number
    }>(
      `
      SELECT track_id, from_station, to_station, description, length_km
      FROM railway_routes
      WHERE track_id = ANY($1)
      ORDER BY array_position($1, track_id)
      `,
      [routeIds]
    );
    // Convert length_km to number (PostgreSQL returns it as string)
    return result.rows.map(row => ({
      track_id: row.track_id,
      from_station: row.from_station,
      to_station: row.to_station,
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
    // Find routes near each station
    const fromRoutes = await findRoutesNearStation(fromStationId);
    const toRoutes = await findRoutesNearStation(toStationId);
    const viaRouteSets = await Promise.all(
      viaStationIds.map(id => findRoutesNearStation(id))
    );

    // Validate we found routes near all stations
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

    // Build station sequence: from -> via1 -> via2 -> ... -> to
    const stationSequence = [fromStationId, ...viaStationIds, toStationId];
    const routeSequence = [fromRoutes, ...viaRouteSets, toRoutes];

    // Find path sequentially between each pair of stations
    const allSegments: number[][] = [];
    let previousEndRoute: number | null = null;

    for (let i = 0; i < stationSequence.length - 1; i++) {
      const segmentFromStation = stationSequence[i];
      const segmentToStation = stationSequence[i + 1];
      let segmentFromRoutes = routeSequence[i];
      const segmentToRoutes = routeSequence[i + 1];

      // Continue from the previous segment's end route if possible
      if (previousEndRoute !== null && segmentFromRoutes.includes(previousEndRoute)) {
        segmentFromRoutes = [previousEndRoute];
      }

      let segmentPath: number[] | null = null;

      // Try with increasing buffer sizes (50km, 100km, 150km)
      const bufferSizes = [50000, 100000, 150000];

      for (const bufferSize of bufferSizes) {
        const graph = await buildRouteGraphInBuffer(segmentFromStation, segmentToStation, bufferSize);
        segmentPath = findShortestPath(graph, segmentFromRoutes, segmentToRoutes);

        if (segmentPath) break;
      }

      if (!segmentPath) {
        return {
          routes: [],
          totalDistance: 0,
          error: `No path found for segment ${i + 1}`
        };
      }

      allSegments.push(segmentPath);
      previousEndRoute = segmentPath[segmentPath.length - 1];
    }

    // Concatenate segments, removing duplicate routes at connection points
    const path: number[] = [];
    for (let i = 0; i < allSegments.length; i++) {
      const segment = allSegments[i];
      if (i === 0) {
        path.push(...segment);
      } else {
        // Skip first route if it's the same as the last route from previous segment
        const startIdx = segment[0] === path[path.length - 1] ? 1 : 0;
        path.push(...segment.slice(startIdx));
      }
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
