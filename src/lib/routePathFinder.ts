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
  line_class: string | null;
  /** First coordinate of route geometry */
  startCoord: [number, number];
  /** Second coordinate of route geometry (near start) */
  nearStartCoord: [number, number];
  /** Second-to-last coordinate of route geometry (near end) */
  nearEndCoord: [number, number];
  /** Last coordinate of route geometry */
  endCoord: [number, number];
}

/**
 * Cost multiplier for route-level pathfinding based on line_class.
 * Lower = preferred. Main/highspeed routes are preferred over branch routes.
 */
function getRouteCostMultiplier(info: RouteBearingInfo): number {
  if (info.line_class === 'highspeed') return 0.5;
  if (info.line_class === 'main') return 1.0;
  return 2.0; // branch or unknown
}

/** Tolerance in meters for matching route endpoints as connected */
const ENDPOINT_TOLERANCE_METERS = 500;

type EndpointSide = 'start' | 'end';

/**
 * Check if two coordinates are within a distance tolerance (in meters).
 * Coordinates are [longitude, latitude]. Uses Haversine formula.
 */
function coordsNear(a: [number, number], b: [number, number], toleranceMeters: number): boolean {
  // Quick reject (~5km at mid-latitudes)
  if (Math.abs(a[1] - b[1]) > 0.05 || Math.abs(a[0] - b[0]) > 0.05) return false;

  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const d = 2 * R * Math.asin(Math.sqrt(h));
  return d <= toleranceMeters;
}

function getEndpointCoord(info: RouteBearingInfo, side: EndpointSide): [number, number] {
  return side === 'start' ? info.startCoord : info.endCoord;
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
 * When routes are found, extends to the next tolerance level to catch
 * nearby routes at slightly different distances (e.g. parallel tracks).
 */
async function findRoutesNearStation(stationId: number): Promise<number[]> {
  const client = await pool.connect();
  try {
    // Progressive tolerance values (in meters)
    const tolerances = [100, 500, 1000, 2000, 5000];

    for (let i = 0; i < tolerances.length; i++) {
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
        [stationId, tolerances[i]]
      );

      if (result.rows.length > 0) {
        // Extend to next tolerance level to catch nearby routes at slightly
        // different distances (e.g. parallel tracks at the same station)
        if (i + 1 < tolerances.length) {
          const extended = await client.query<{ track_id: number }>(
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
            [stationId, tolerances[i + 1]]
          );
          return extended.rows.map(row => row.track_id);
        }
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
        r.line_class,
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
        line_class: row.line_class,
        startCoord: [row.start_x, row.start_y],
        nearStartCoord: [row.near_start_x, row.near_start_y],
        nearEndCoord: [row.near_end_x, row.near_end_y],
        endCoord: [row.end_x, row.end_y],
      });
    }

    // Build connections via endpoint coordinate proximity (O(n^2) but in JS, no SQL CROSS JOIN)
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        const r1Info = routeInfo.get(routes[i].track_id)!;
        const r2Info = routeInfo.get(routes[j].track_id)!;
        if (
          coordsNear(r1Info.startCoord, r2Info.startCoord, ENDPOINT_TOLERANCE_METERS) ||
          coordsNear(r1Info.startCoord, r2Info.endCoord, ENDPOINT_TOLERANCE_METERS) ||
          coordsNear(r1Info.endCoord, r2Info.startCoord, ENDPOINT_TOLERANCE_METERS) ||
          coordsNear(r1Info.endCoord, r2Info.endCoord, ENDPOINT_TOLERANCE_METERS)
        ) {
          graph.addConnection(routes[i].track_id, routes[j].track_id);
          graph.addConnection(routes[j].track_id, routes[i].track_id);
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
 * Find which endpoints connect between two routes via coordinate proximity.
 * Returns the endpoint sides, or null if routes don't connect.
 */
function findConnectionEndpoint(
  infoA: RouteBearingInfo,
  infoB: RouteBearingInfo
): { sideA: EndpointSide; sideB: EndpointSide } | null {
  if (coordsNear(infoA.endCoord, infoB.startCoord, ENDPOINT_TOLERANCE_METERS)) return { sideA: 'end', sideB: 'start' };
  if (coordsNear(infoA.endCoord, infoB.endCoord, ENDPOINT_TOLERANCE_METERS)) return { sideA: 'end', sideB: 'end' };
  if (coordsNear(infoA.startCoord, infoB.startCoord, ENDPOINT_TOLERANCE_METERS)) return { sideA: 'start', sideB: 'start' };
  if (coordsNear(infoA.startCoord, infoB.endCoord, ENDPOINT_TOLERANCE_METERS)) return { sideA: 'start', sideB: 'end' };
  return null;
}

/**
 * Get the exit bearing of a route at a given endpoint side.
 */
function getExitBearing(info: RouteBearingInfo, side: EndpointSide): number {
  if (side === 'end') {
    return calculateBearing(info.nearEndCoord, info.endCoord);
  } else {
    return calculateBearing(info.nearStartCoord, info.startCoord);
  }
}

/**
 * Get the entry bearing of a route at a given endpoint side.
 */
function getEntryBearing(info: RouteBearingInfo, side: EndpointSide): number {
  if (side === 'start') {
    return calculateBearing(info.startCoord, info.nearStartCoord);
  } else {
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
  const connection = findConnectionEndpoint(infoA, infoB);
  if (!connection) return false;

  const exitBear = getExitBearing(infoA, connection.sideA);
  const entryBear = getEntryBearing(infoB, connection.sideB);

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
 * Weighted Dijkstra-like search through route graph (in-memory).
 * Costs are weighted by line_class: highspeed (0.5x), main (1.0x), branch (2.0x).
 * Tracks exit endpoint coordinate at each step to prevent "teleportation" between route endpoints.
 * When traversing a route, you enter at one endpoint and exit at the other — the next
 * route must have an endpoint near your exit coordinate.
 */
function findShortestPath(
  graph: RouteGraph,
  startRoutes: number[],
  endRoutes: number[],
  routeInfo: Map<number, RouteBearingInfo>
): number[] | null {
  if (startRoutes.length === 0 || endRoutes.length === 0) {
    return null;
  }

  const endSet = new Set(endRoutes);
  const queue: { route: number; path: number[]; exitSide: EndpointSide; cost: number }[] = [];
  const bestCost = new Map<string, number>();

  let bestPath: number[] | null = null;
  let bestPathCost = Infinity;

  // Initialize queue with start routes (try both directions)
  for (const route of startRoutes) {
    const info = routeInfo.get(route);
    if (!info) continue;

    for (const exitSide of ['start', 'end'] as EndpointSide[]) {
      const key = `${route}_${exitSide}`;
      if (!bestCost.has(key)) {
        bestCost.set(key, 0);
        queue.push({ route, path: [route], exitSide, cost: 0 });
      }
    }
  }

  while (queue.length > 0) {
    // Pick lowest-cost entry
    let minIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].cost < queue[minIdx].cost) minIdx = i;
    }
    const current = queue.splice(minIdx, 1)[0];

    const currentKey = `${current.route}_${current.exitSide}`;
    const currentBest = bestCost.get(currentKey);
    if (currentBest !== undefined && current.cost > currentBest) {
      continue;
    }

    if (current.cost >= bestPathCost) {
      continue;
    }

    // Check if we reached the end
    if (endSet.has(current.route)) {
      if (current.cost < bestPathCost) {
        bestPath = current.path;
        bestPathCost = current.cost;
      }
      continue;
    }

    // Get exit coordinate for this route
    const currentInfo = routeInfo.get(current.route);
    if (!currentInfo) continue;
    const exitCoord = getEndpointCoord(currentInfo, current.exitSide);

    // Explore neighbors
    const neighbors = graph.getNeighbors(current.route);
    for (const neighbor of neighbors) {
      const neighborInfo = routeInfo.get(neighbor);
      if (!neighborInfo) continue;

      // Determine which endpoint of neighbor connects to our exit coordinate
      let newExitSide: EndpointSide;
      if (coordsNear(neighborInfo.startCoord, exitCoord, ENDPOINT_TOLERANCE_METERS)) {
        newExitSide = 'end'; // enters at start, exits at end
      } else if (coordsNear(neighborInfo.endCoord, exitCoord, ENDPOINT_TOLERANCE_METERS)) {
        newExitSide = 'start'; // enters at end, exits at start
      } else {
        continue; // Neighbor doesn't connect at our exit coordinate
      }

      const weightedCost = (neighborInfo.length_km ?? 0) * getRouteCostMultiplier(neighborInfo);
      const newCost = current.cost + weightedCost;

      const key = `${neighbor}_${newExitSide}`;
      const prevBest = bestCost.get(key);
      if (prevBest === undefined || newCost < prevBest) {
        bestCost.set(key, newCost);
        queue.push({
          route: neighbor,
          path: [...current.path, neighbor],
          exitSide: newExitSide,
          cost: newCost,
        });
      }
    }
  }

  return bestPath;
}

/**
 * BFS that avoids backtracking transitions between consecutive routes.
 * Uses best-distance tracking to allow alternative paths through the same node.
 * Distance-bounded to prevent excessive search.
 * Tracks exit endpoint coordinate to prevent teleportation between route endpoints.
 */
function findShortestPathAvoidingBacktracking(
  graph: RouteGraph,
  startRoutes: number[],
  endRoutes: number[],
  routeInfo: Map<number, RouteBearingInfo>,
  maxDistanceKm: number
): number[] | null {
  if (startRoutes.length === 0 || endRoutes.length === 0) {
    return null;
  }

  const endSet = new Set(endRoutes);
  const queue: { route: number; path: number[]; distanceKm: number; exitSide: EndpointSide }[] = [];
  const bestDistance = new Map<string, number>();

  let shortestPath: number[] | null = null;
  let shortestDistance = Infinity;

  // Initialize queue with start routes (try both directions)
  for (const route of startRoutes) {
    const info = routeInfo.get(route);
    if (!info) continue;

    for (const exitSide of ['start', 'end'] as EndpointSide[]) {
      const key = `${route}_${exitSide}`;
      queue.push({ route, path: [route], distanceKm: 0, exitSide });
      bestDistance.set(key, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Skip if we already found a better path to this node+direction
    const currentKey = `${current.route}_${current.exitSide}`;
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

    // Get exit coordinate for this route
    const currentInfo = routeInfo.get(current.route);
    if (!currentInfo) continue;
    const exitCoord = getEndpointCoord(currentInfo, current.exitSide);

    // Explore neighbors
    const neighbors = graph.getNeighbors(current.route);
    for (const neighbor of neighbors) {
      const neighborInfo = routeInfo.get(neighbor);
      if (!neighborInfo) continue;

      // Determine which endpoint of neighbor connects to our exit coordinate
      let newExitSide: EndpointSide;
      if (coordsNear(neighborInfo.startCoord, exitCoord, ENDPOINT_TOLERANCE_METERS)) {
        newExitSide = 'end';
      } else if (coordsNear(neighborInfo.endCoord, exitCoord, ENDPOINT_TOLERANCE_METERS)) {
        newExitSide = 'start';
      } else {
        continue;
      }

      // Prevent cycles
      if (current.path.includes(neighbor)) {
        continue;
      }

      // Check for backtracking at the transition
      if (isBacktrackingTransition(currentInfo, neighborInfo)) {
        continue;
      }

      const weightedCost = (neighborInfo.length_km ?? 0) * getRouteCostMultiplier(neighborInfo);
      const newDistanceKm = current.distanceKm + weightedCost;

      // Only explore if this is the best path to this node+direction so far
      const neighborKey = `${neighbor}_${newExitSide}`;
      const bestToNode = bestDistance.get(neighborKey);
      if (bestToNode === undefined || newDistanceKm < bestToNode) {
        bestDistance.set(neighborKey, newDistanceKm);
        queue.push({
          route: neighbor,
          path: [...current.path, neighbor],
          distanceKm: newDistanceKm,
          exitSide: newExitSide,
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

      // Try with increasing buffer sizes until we find a path
      const bufferSizes = [50000, 100000, 200000, 500000, 1000000]; // 50km, 100km, 200km, 500km, 1000km

      for (const bufferSize of bufferSizes) {
        const { graph, routeInfo } = await buildRouteGraphInBuffer(segmentFromStation, segmentToStation, bufferSize);
        segmentPath = findShortestPath(graph, segmentFromRoutes, segmentToRoutes, routeInfo);

        if (segmentPath) {
          // Check for backtracking and try to find alternative
          if (hasRoutePathBacktracking(segmentPath, routeInfo)) {
            const originalDistanceKm = calculatePathDistanceKm(segmentPath, routeInfo);
            const maxDistanceKm = Math.min(originalDistanceKm * 2, originalDistanceKm + 10);

            const alternative = findShortestPathAvoidingBacktracking(
              graph, segmentFromRoutes, segmentToRoutes, routeInfo, maxDistanceKm
            );

            if (alternative) {
              segmentPath = alternative;
            }
          }

          break;
        }
      }

      if (!segmentPath) {
        return {
          routes: [],
          totalDistance: 0,
          error: `No path found for segment ${i + 1}. The stations might be too far apart (tried up to 1000km). Try adding via stations to break up the journey.`
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
