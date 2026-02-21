'use server';

import pool from './db';
import { calculateBearing } from './geoUtils';

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

/** Bearing info for backtracking detection at route connection points */
interface RouteBearingInfo {
  track_id: number;
  from_station: string;
  to_station: string;
  length_km: number;
  /** First coordinate of route geometry */
  startCoord: [number, number];
  /** Second coordinate of route geometry (near start) */
  nearStartCoord: [number, number];
  /** Second-to-last coordinate of route geometry (near end) */
  nearEndCoord: [number, number];
  /** Last coordinate of route geometry */
  endCoord: [number, number];
}

interface GraphWithBearingInfo {
  graph: RouteGraph;
  routeInfo: Map<number, RouteBearingInfo>;
}

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
 * Uses progressive tolerance: 100m → 500m → 1km → 2km → 5km
 */
async function findRoutesNearStation(stationId: number): Promise<number[]> {
  const client = await pool.connect();
  try {
    // Progressive tolerance values (in meters)
    const tolerances = [100, 500, 1000, 2000, 5000];

    for (const tolerance of tolerances) {
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
          AND r.usage_type = 0
        ORDER BY r.track_id
        `,
        [stationId, tolerance]
      );

      // If we found routes, return them
      if (result.rows.length > 0) {
        return result.rows.map(row => row.track_id);
      }
    }

    // No routes found even at maximum tolerance
    return [];
  } finally {
    client.release();
  }
}

/**
 * Build route graph for routes within a buffer area around start/end stations.
 * Also fetches endpoint coordinates for backtracking detection.
 * Routes are connected based on station name matching (not distance).
 */
async function buildRouteGraphInBuffer(
  fromStationId: number,
  toStationId: number,
  bufferMeters: number
): Promise<GraphWithBearingInfo> {
  const client = await pool.connect();
  const graph = new RouteGraph();
  const routeInfo = new Map<number, RouteBearingInfo>();

  try {
    // Fetch routes in area with endpoint coordinates for bearing calculation
    const result = await client.query<{
      track_id: number;
      from_station: string;
      to_station: string;
      length_km: string | number;
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
      )
      SELECT DISTINCT
        r.track_id,
        r.from_station,
        r.to_station,
        r.length_km,
        ST_X(ST_PointN(r.geometry, 1)) as start_x,
        ST_Y(ST_PointN(r.geometry, 1)) as start_y,
        ST_X(ST_PointN(r.geometry, 2)) as near_start_x,
        ST_Y(ST_PointN(r.geometry, 2)) as near_start_y,
        ST_X(ST_PointN(r.geometry, GREATEST(ST_NPoints(r.geometry) - 1, 1))) as near_end_x,
        ST_Y(ST_PointN(r.geometry, GREATEST(ST_NPoints(r.geometry) - 1, 1))) as near_end_y,
        ST_X(ST_PointN(r.geometry, ST_NPoints(r.geometry))) as end_x,
        ST_Y(ST_PointN(r.geometry, ST_NPoints(r.geometry))) as end_y
      FROM railway_routes r, search_area
      WHERE ST_Intersects(r.geometry, search_area.buffer_geom)
        AND r.usage_type = 0
      `,
      [fromStationId, toStationId, bufferMeters]
    );

    // Store route info and build connections in JS
    const routes = result.rows;
    for (const row of routes) {
      const lengthKm = typeof row.length_km === 'string' ? parseFloat(row.length_km) : row.length_km;
      routeInfo.set(row.track_id, {
        track_id: row.track_id,
        from_station: row.from_station,
        to_station: row.to_station,
        length_km: lengthKm,
        startCoord: [row.start_x, row.start_y],
        nearStartCoord: [row.near_start_x, row.near_start_y],
        nearEndCoord: [row.near_end_x, row.near_end_y],
        endCoord: [row.end_x, row.end_y],
      });
    }

    // Build connections via station name matching (O(n^2) but in JS, no SQL CROSS JOIN)
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        const r1 = routes[i];
        const r2 = routes[j];
        if (
          r1.from_station === r2.from_station ||
          r1.from_station === r2.to_station ||
          r1.to_station === r2.from_station ||
          r1.to_station === r2.to_station
        ) {
          graph.addConnection(r1.track_id, r2.track_id);
          graph.addConnection(r2.track_id, r1.track_id);
        }
      }
    }

    return { graph, routeInfo };
  } finally {
    client.release();
  }
}

// ============================================================================
// BACKTRACKING DETECTION
// ============================================================================

/**
 * Find the shared station name between two connected routes.
 * Returns null if routes don't share a station.
 */
function findConnectionStation(
  infoA: RouteBearingInfo,
  infoB: RouteBearingInfo
): string | null {
  // Check all 4 combinations; prefer from→to connections (more common direction)
  if (infoA.to_station === infoB.from_station) return infoA.to_station;
  if (infoA.to_station === infoB.to_station) return infoA.to_station;
  if (infoA.from_station === infoB.from_station) return infoA.from_station;
  if (infoA.from_station === infoB.to_station) return infoA.from_station;
  return null;
}

/**
 * Get the exit bearing of a route at a given station.
 * This is the bearing of the route as it approaches/exits the connection station.
 */
function getExitBearing(info: RouteBearingInfo, station: string): number {
  if (station === info.to_station) {
    // Route exits forward (toward end): bearing from near-end to end
    return calculateBearing(info.nearEndCoord, info.endCoord);
  } else {
    // Route exits backward (toward start): bearing from near-start to start
    return calculateBearing(info.nearStartCoord, info.startCoord);
  }
}

/**
 * Get the entry bearing of a route at a given station.
 * This is the bearing of the route as it departs from the connection station.
 */
function getEntryBearing(info: RouteBearingInfo, station: string): number {
  if (station === info.from_station) {
    // Route enters forward (from start): bearing from start to near-start
    return calculateBearing(info.startCoord, info.nearStartCoord);
  } else {
    // Route enters backward (from end): bearing from end to near-end
    return calculateBearing(info.endCoord, info.nearEndCoord);
  }
}

/**
 * Check if transitioning from routeA to routeB constitutes backtracking.
 * Returns true if the bearing difference at the connection point exceeds 140°.
 */
function isBacktrackingTransition(
  infoA: RouteBearingInfo,
  infoB: RouteBearingInfo
): boolean {
  const station = findConnectionStation(infoA, infoB);
  if (!station) return false;

  const exitBear = getExitBearing(infoA, station);
  const entryBear = getEntryBearing(infoB, station);

  const diff = Math.abs(entryBear - exitBear);
  const normalizedDiff = diff > 180 ? 360 - diff : diff;

  return normalizedDiff > 140;
}

/**
 * Check if a route path has any backtracking transitions between consecutive routes.
 */
function hasRoutePathBacktracking(
  path: number[],
  routeInfo: Map<number, RouteBearingInfo>
): boolean {
  if (path.length < 2) return false;

  for (let i = 0; i < path.length - 1; i++) {
    const infoA = routeInfo.get(path[i]);
    const infoB = routeInfo.get(path[i + 1]);
    if (!infoA || !infoB) continue;

    if (isBacktrackingTransition(infoA, infoB)) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// PATH FINDING
// ============================================================================

/**
 * BFS to find shortest path through route graph (in-memory).
 * Tracks exit station at each step to prevent "teleportation" between route endpoints.
 * When traversing a route, you enter at one station and exit at the other — the next
 * route must connect at your exit station.
 *
 * @param entryStation - If provided, constrains the direction for start routes
 *   (used when continuing from a previous segment in multi-segment paths)
 */
function findShortestPath(
  graph: RouteGraph,
  startRoutes: number[],
  endRoutes: number[],
  routeInfo: Map<number, RouteBearingInfo>,
  entryStation?: string | null
): number[] | null {
  if (startRoutes.length === 0 || endRoutes.length === 0) {
    return null;
  }

  const endSet = new Set(endRoutes);
  const queue: { route: number; path: number[]; exitStation: string }[] = [];
  const visited = new Set<string>();

  // Initialize queue with start routes
  for (const route of startRoutes) {
    const info = routeInfo.get(route);
    if (!info) continue;

    // Determine possible exit stations
    let exitStations: string[];
    if (entryStation) {
      // Constrained: enter from entryStation, exit at the other end
      if (info.from_station === entryStation) {
        exitStations = [info.to_station];
      } else if (info.to_station === entryStation) {
        exitStations = [info.from_station];
      } else {
        continue; // Route doesn't connect at entry station
      }
    } else {
      // Try both directions
      exitStations = [info.from_station, info.to_station];
    }

    for (const exitStation of exitStations) {
      const key = `${route}_${exitStation}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ route, path: [route], exitStation });
      }
    }
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
      const neighborInfo = routeInfo.get(neighbor);
      if (!neighborInfo) continue;

      // Only follow connections at our exit station
      let newExitStation: string;
      if (neighborInfo.from_station === current.exitStation) {
        newExitStation = neighborInfo.to_station;
      } else if (neighborInfo.to_station === current.exitStation) {
        newExitStation = neighborInfo.from_station;
      } else {
        continue; // Neighbor doesn't connect at our exit station
      }

      const key = `${neighbor}_${newExitStation}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({
          route: neighbor,
          path: [...current.path, neighbor],
          exitStation: newExitStation,
        });
      }
    }
  }

  return null; // No path found
}

/**
 * BFS that avoids backtracking transitions between consecutive routes.
 * Uses best-distance tracking to allow alternative paths through the same node.
 * Distance-bounded to prevent excessive search.
 * Tracks exit station to prevent teleportation between route endpoints.
 *
 * @param entryStation - If provided, constrains the direction for start routes
 */
function findShortestPathAvoidingBacktracking(
  graph: RouteGraph,
  startRoutes: number[],
  endRoutes: number[],
  routeInfo: Map<number, RouteBearingInfo>,
  maxDistanceKm: number,
  entryStation?: string | null
): number[] | null {
  if (startRoutes.length === 0 || endRoutes.length === 0) {
    return null;
  }

  const endSet = new Set(endRoutes);
  const queue: { route: number; path: number[]; distanceKm: number; exitStation: string }[] = [];
  const bestDistance = new Map<string, number>();

  let shortestPath: number[] | null = null;
  let shortestDistance = Infinity;

  // Initialize queue with start routes
  for (const route of startRoutes) {
    const info = routeInfo.get(route);
    if (!info) continue;

    let exitStations: string[];
    if (entryStation) {
      if (info.from_station === entryStation) {
        exitStations = [info.to_station];
      } else if (info.to_station === entryStation) {
        exitStations = [info.from_station];
      } else {
        continue;
      }
    } else {
      exitStations = [info.from_station, info.to_station];
    }

    for (const exitStation of exitStations) {
      const key = `${route}_${exitStation}`;
      queue.push({ route, path: [route], distanceKm: 0, exitStation });
      bestDistance.set(key, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Skip if we already found a better path to this node+direction
    const currentKey = `${current.route}_${current.exitStation}`;
    const currentBest = bestDistance.get(currentKey);
    if (currentBest !== undefined && current.distanceKm > currentBest) {
      continue;
    }

    // Prune if exceeding max distance
    if (current.distanceKm > maxDistanceKm) {
      continue;
    }

    // Check if we reached the end
    if (endSet.has(current.route)) {
      if (current.distanceKm < shortestDistance) {
        shortestPath = current.path;
        shortestDistance = current.distanceKm;
      }
      continue;
    }

    // Explore neighbors
    const neighbors = graph.getNeighbors(current.route);
    for (const neighbor of neighbors) {
      const neighborInfo = routeInfo.get(neighbor);
      if (!neighborInfo) continue;

      // Only follow connections at our exit station
      let newExitStation: string;
      if (neighborInfo.from_station === current.exitStation) {
        newExitStation = neighborInfo.to_station;
      } else if (neighborInfo.to_station === current.exitStation) {
        newExitStation = neighborInfo.from_station;
      } else {
        continue;
      }

      // Prevent cycles
      if (current.path.includes(neighbor)) {
        continue;
      }

      // Check for backtracking at the transition
      const currentInfo = routeInfo.get(current.route);
      if (currentInfo && neighborInfo && isBacktrackingTransition(currentInfo, neighborInfo)) {
        continue;
      }

      const neighborLengthKm = neighborInfo.length_km ?? 0;
      const newDistanceKm = current.distanceKm + neighborLengthKm;

      // Only explore if this is the best path to this node+direction so far
      const neighborKey = `${neighbor}_${newExitStation}`;
      const bestToNode = bestDistance.get(neighborKey);
      if (bestToNode === undefined || newDistanceKm < bestToNode) {
        bestDistance.set(neighborKey, newDistanceKm);
        queue.push({
          route: neighbor,
          path: [...current.path, neighbor],
          distanceKm: newDistanceKm,
          exitStation: newExitStation,
        });
      }
    }
  }

  return shortestPath;
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
 * Calculate total distance of a path using routeInfo
 */
function calculatePathDistanceKm(
  path: number[],
  routeInfo: Map<number, RouteBearingInfo>
): number {
  let total = 0;
  for (const trackId of path) {
    const info = routeInfo.get(trackId);
    if (info) total += info.length_km;
  }
  return total;
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
    let previousExitStation: string | null = null;

    for (let i = 0; i < stationSequence.length - 1; i++) {
      const segmentFromStation = stationSequence[i];
      const segmentToStation = stationSequence[i + 1];
      let segmentFromRoutes = routeSequence[i];
      const segmentToRoutes = routeSequence[i + 1];

      // Continue from the previous segment's end route if possible
      let entryStation: string | null = null;
      if (previousEndRoute !== null && segmentFromRoutes.includes(previousEndRoute)) {
        segmentFromRoutes = [previousEndRoute];
        entryStation = previousExitStation;
      }

      let segmentPath: number[] | null = null;
      let segmentRouteInfo: Map<number, RouteBearingInfo> | null = null;

      // Try with increasing buffer sizes until we find a path
      const bufferSizes = [50000, 100000, 200000, 500000, 1000000]; // 50km, 100km, 200km, 500km, 1000km

      for (const bufferSize of bufferSizes) {
        const { graph, routeInfo } = await buildRouteGraphInBuffer(segmentFromStation, segmentToStation, bufferSize);
        segmentPath = findShortestPath(graph, segmentFromRoutes, segmentToRoutes, routeInfo, entryStation);

        if (segmentPath) {
          segmentRouteInfo = routeInfo;

          // Check for backtracking and try to find alternative
          if (hasRoutePathBacktracking(segmentPath, routeInfo)) {
            const originalDistanceKm = calculatePathDistanceKm(segmentPath, routeInfo);
            const maxDistanceKm = Math.min(originalDistanceKm * 2, originalDistanceKm + 10);

            const alternative = findShortestPathAvoidingBacktracking(
              graph, segmentFromRoutes, segmentToRoutes, routeInfo, maxDistanceKm, entryStation
            );

            if (alternative) {
              segmentPath = alternative;
            }
          }

          break;
        }
      }

      if (!segmentPath || !segmentRouteInfo) {
        return {
          routes: [],
          totalDistance: 0,
          error: `No path found for segment ${i + 1}. The stations might be too far apart (tried up to 1000km). Try adding via stations to break up the journey.`
        };
      }

      allSegments.push(segmentPath);
      previousEndRoute = segmentPath[segmentPath.length - 1];

      // Compute exit station of the last route for the next segment's entry
      previousExitStation = null;
      if (segmentPath.length >= 2) {
        const lastInfo = segmentRouteInfo.get(segmentPath[segmentPath.length - 1]);
        const prevInfo = segmentRouteInfo.get(segmentPath[segmentPath.length - 2]);
        if (lastInfo && prevInfo) {
          const conn = findConnectionStation(prevInfo, lastInfo);
          if (conn) {
            previousExitStation = lastInfo.from_station === conn ? lastInfo.to_station : lastInfo.from_station;
          }
        }
      }
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
