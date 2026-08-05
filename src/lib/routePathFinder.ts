"use server";

import pool from "./db";
import {
  BACKTRACKING_THRESHOLD_DEGREES,
  calculateBearing,
  haversineDistance,
  normalizeBearingDifference,
} from "./geoUtils";
import type { PartialRouteGeometry, PlannerRoute } from "./types";

interface PathResult {
  routes: PlannerRoute[];
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
  if (info.line_class === "highspeed") return 0.5;
  if (info.line_class === "main") return 1.0;
  return 2.0; // branch or unknown
}

/** Tolerance in meters for matching route endpoints as connected */
const ENDPOINT_TOLERANCE_METERS = 500;

/**
 * Cost, expressed in km of main line, charged per km of gap left between the
 * endpoints of two consecutive routes.
 *
 * Endpoint coordinates are hand-picked click points, so two routes that really
 * meet still land a few metres apart — hence the tolerance above. But a junction
 * complex packs several distinct endpoints a few hundred metres apart, all
 * inside that tolerance. Without a penalty the search treats the jump between
 * them as free and skips the short connecting route that actually covers the
 * gap, producing a path with a hole in it. Penalising the gap makes the covered
 * chain cheaper than the jump, while still allowing a jump when nothing covers it.
 */
const GAP_PENALTY_PER_KM = 25;

type EndpointSide = "start" | "end";

const ENDPOINT_SIDES: EndpointSide[] = ["start", "end"];

function getEndpointCoord(info: RouteBearingInfo, side: EndpointSide): [number, number] {
  return side === "start" ? info.startCoord : info.endCoord;
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

// ============================================================================
// STATION -> ROUTES
// ============================================================================

/** Progressive tolerance levels (meters) for matching routes to a station */
const STATION_TOLERANCES = [100, 500, 1000, 2000, 5000];

/**
 * Find the routes passing near each of the given stations.
 *
 * One indexed query covers every station at the widest tolerance; the
 * progressive narrowing then happens in memory. (Querying each tolerance level
 * separately meant up to six sequential sequential scans per station, because
 * `ST_DWithin` on a `::geography` cast cannot use the geometry index.)
 *
 * Per station: the smallest tolerance level that matches anything wins, extended
 * to the next level up to catch nearby routes at slightly different distances
 * (e.g. parallel tracks at the same station).
 */
async function findRoutesNearStations(stationIds: number[]): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  if (stationIds.length === 0) return result;

  const maxTolerance = STATION_TOLERANCES[STATION_TOLERANCES.length - 1];
  const client = await pool.connect();
  try {
    // ST_DWithin against geometry_3857 (indexed) with 1/cos(lat) scaling so the
    // real ground radius matches maxTolerance; exact distance is then measured
    // on the few candidates that survive.
    const rows = await client.query<{
      station_id: string | number;
      track_id: number;
      distance_m: string | number;
    }>(
      `
      WITH s AS (
        SELECT id, coordinates, ST_Transform(coordinates, 3857) AS geom_3857
        FROM stations
        WHERE id = ANY($1)
      )
      SELECT
        s.id AS station_id,
        r.track_id,
        ST_Distance(r.geometry::geography, s.coordinates::geography) AS distance_m
      FROM s
      JOIN railway_routes r
        ON r.usage_type = 0
       AND ST_DWithin(
             r.geometry_3857,
             s.geom_3857,
             $2 / GREATEST(cos(radians(ST_Y(s.coordinates))), 0.01)
           )
      ORDER BY s.id, distance_m
      `,
      [stationIds, maxTolerance],
    );

    const byStation = new Map<number, { track_id: number; distance: number }[]>();
    for (const row of rows.rows) {
      const stationId = Number(row.station_id);
      const distance =
        typeof row.distance_m === "string" ? parseFloat(row.distance_m) : row.distance_m;
      if (distance > maxTolerance) continue;
      if (!byStation.has(stationId)) byStation.set(stationId, []);
      byStation.get(stationId)!.push({ track_id: row.track_id, distance });
    }

    for (const stationId of stationIds) {
      const candidates = byStation.get(stationId) ?? [];
      let matched: number[] = [];

      for (let i = 0; i < STATION_TOLERANCES.length; i++) {
        if (!candidates.some((c) => c.distance <= STATION_TOLERANCES[i])) continue;
        const cutoff = STATION_TOLERANCES[Math.min(i + 1, STATION_TOLERANCES.length - 1)];
        matched = candidates.filter((c) => c.distance <= cutoff).map((c) => c.track_id);
        break;
      }

      result.set(stationId, matched);
    }

    return result;
  } finally {
    client.release();
  }
}

// ============================================================================
// GRAPH BUILDING
// ============================================================================

/** Grid cell size in degrees of latitude — one tolerance radius across. */
const CELL_DEGREES = ENDPOINT_TOLERANCE_METERS / 111_320;

function latBand(lat: number): number {
  return Math.floor(lat / CELL_DEGREES);
}

/**
 * Longitude band within a latitude band. Scaled by cos(lat) so a cell stays at
 * least one tolerance radius wide on the ground even at Nordic latitudes, which
 * is what lets a 3x3 cell scan find every endpoint within tolerance.
 */
function lonBand(lon: number, band: number): number {
  const refLat = (band + 0.5) * CELL_DEGREES;
  const scale = Math.max(Math.cos((refLat * Math.PI) / 180), 0.01);
  return Math.floor((lon * scale) / CELL_DEGREES);
}

/**
 * Load the whole regular-usage route network and connect routes whose endpoints
 * are within ENDPOINT_TOLERANCE_METERS of each other.
 *
 * The network is small enough (a few thousand routes, endpoints only) to load in
 * one query, so there is no buffering around the stations: pathfinding used to
 * retry with 50km/100km/.../1000km buffers, re-querying and rebuilding the graph
 * each time a segment failed.
 *
 * Endpoints are bucketed into a spatial grid so pairing stays roughly linear
 * instead of comparing every route against every other one.
 */
async function loadRouteGraph(signature: string): Promise<CachedRouteGraph> {
  const client = await pool.connect();
  const graph = new RouteGraph();
  const routeInfo = new Map<number, RouteBearingInfo>();

  try {
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
      SELECT
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
      FROM railway_routes r
      WHERE r.usage_type = 0
        AND r.geometry IS NOT NULL
        AND ST_NPoints(r.geometry) >= 2
      `,
    );

    for (const row of result.rows) {
      const lengthKm =
        typeof row.length_km === "string" ? parseFloat(row.length_km) : row.length_km;
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

    // Bucket every endpoint into the spatial grid
    const grid = new Map<string, number[]>();
    for (const info of routeInfo.values()) {
      for (const side of ENDPOINT_SIDES) {
        const [lon, lat] = getEndpointCoord(info, side);
        const band = latBand(lat);
        const key = `${band}:${lonBand(lon, band)}`;
        const cell = grid.get(key);
        if (cell) cell.push(info.track_id);
        else grid.set(key, [info.track_id]);
      }
    }

    // Connect routes sharing an endpoint location, scanning the 3x3 neighbourhood
    for (const info of routeInfo.values()) {
      for (const side of ENDPOINT_SIDES) {
        const coord = getEndpointCoord(info, side);
        const band = latBand(coord[1]);

        for (let b = band - 1; b <= band + 1; b++) {
          const lb = lonBand(coord[0], b);
          for (let l = lb - 1; l <= lb + 1; l++) {
            const cell = grid.get(`${b}:${l}`);
            if (!cell) continue;

            for (const otherId of cell) {
              if (otherId === info.track_id) continue;
              const other = routeInfo.get(otherId)!;
              const gap = Math.min(
                haversineDistance(coord, other.startCoord),
                haversineDistance(coord, other.endCoord),
              );
              if (gap > ENDPOINT_TOLERANCE_METERS) continue;

              graph.addConnection(info.track_id, otherId);
              graph.addConnection(otherId, info.track_id);
            }
          }
        }
      }
    }

    return { graph, routeInfo, signature };
  } finally {
    client.release();
  }
}

interface CachedRouteGraph extends GraphWithBearingInfo {
  /** Network fingerprint the graph was built from — see getNetworkSignature. */
  signature: string;
}

let cachedGraph: CachedRouteGraph | null = null;
let graphInFlight: { signature: string; promise: Promise<CachedRouteGraph> } | null = null;

/**
 * Cheap fingerprint of the route network. Every write path bumps `updated_at`,
 * and deletions move the counts, so a matching signature means the cached graph
 * is still accurate.
 */
async function getNetworkSignature(): Promise<string> {
  const result = await pool.query<{ regular: string; total: string; updated: Date | null }>(
    `
    SELECT
      count(*) FILTER (WHERE usage_type = 0) AS regular,
      count(*) AS total,
      max(updated_at) AS updated
    FROM railway_routes
    `,
  );
  const row = result.rows[0];
  return `${row.regular}/${row.total}/${row.updated?.toISOString() ?? "-"}`;
}

/**
 * Route graph for the current network, reused across requests.
 *
 * Extracting endpoint coordinates costs ~450ms because every ST_PointN has to
 * walk the full linestring, so the built graph is kept in memory and only
 * rebuilt when the network fingerprint changes.
 */
async function getRouteGraph(): Promise<GraphWithBearingInfo> {
  const signature = await getNetworkSignature();
  if (cachedGraph?.signature === signature) return cachedGraph;

  // Concurrent searches share one rebuild, as long as they want the same network
  if (graphInFlight?.signature !== signature) {
    graphInFlight = { signature, promise: loadRouteGraph(signature) };
  }

  const pending = graphInFlight;
  try {
    cachedGraph = await pending.promise;
    return cachedGraph;
  } finally {
    if (graphInFlight === pending) graphInFlight = null;
  }
}

// ============================================================================
// BACKTRACKING DETECTION
// ============================================================================

interface EndpointMatch {
  sideA: EndpointSide;
  sideB: EndpointSide;
  gapMeters: number;
}

/**
 * Find which endpoints connect two routes: the closest endpoint pairing within
 * tolerance, or null if they don't connect. Taking the closest rather than the
 * first pairing under tolerance matters inside junction complexes, where several
 * of the four pairings can be under tolerance at once.
 */
function findConnectionEndpoint(
  infoA: RouteBearingInfo,
  infoB: RouteBearingInfo,
): EndpointMatch | null {
  let best: EndpointMatch | null = null;

  for (const sideA of ENDPOINT_SIDES) {
    for (const sideB of ENDPOINT_SIDES) {
      const gapMeters = haversineDistance(
        getEndpointCoord(infoA, sideA),
        getEndpointCoord(infoB, sideB),
      );
      if (gapMeters > ENDPOINT_TOLERANCE_METERS) continue;
      if (!best || gapMeters < best.gapMeters) best = { sideA, sideB, gapMeters };
    }
  }

  return best;
}

/**
 * Work out how a route is entered when arriving at a given coordinate: the
 * nearer of its two endpoints, with the exit side being the other one.
 *
 * Picking the *first* endpoint within tolerance instead makes any route shorter
 * than the tolerance traversable in one direction only — the 0.2km connectors
 * inside a junction complex were reachable but always exited back the way they
 * came in.
 */
function resolveEntry(
  info: RouteBearingInfo,
  arrivalCoord: [number, number],
): { exitSide: EndpointSide; gapMeters: number } | null {
  const toStart = haversineDistance(info.startCoord, arrivalCoord);
  const toEnd = haversineDistance(info.endCoord, arrivalCoord);
  const gapMeters = Math.min(toStart, toEnd);

  if (gapMeters > ENDPOINT_TOLERANCE_METERS) return null;
  return { exitSide: toStart <= toEnd ? "end" : "start", gapMeters };
}

/**
 * Get the exit bearing of a route at a given endpoint side.
 */
function getExitBearing(info: RouteBearingInfo, side: EndpointSide): number {
  if (side === "end") {
    return calculateBearing(info.nearEndCoord, info.endCoord);
  } else {
    return calculateBearing(info.nearStartCoord, info.startCoord);
  }
}

/**
 * Get the entry bearing of a route at a given endpoint side.
 */
function getEntryBearing(info: RouteBearingInfo, side: EndpointSide): number {
  if (side === "start") {
    return calculateBearing(info.startCoord, info.nearStartCoord);
  } else {
    return calculateBearing(info.endCoord, info.nearEndCoord);
  }
}

function oppositeSide(side: EndpointSide): EndpointSide {
  return side === "start" ? "end" : "start";
}

/**
 * Check whether leaving routeA at sideA and entering routeB at entrySideB doubles
 * back: true when the bearing difference at that junction exceeds 140°.
 */
function isBacktrackingAt(
  infoA: RouteBearingInfo,
  sideA: EndpointSide,
  infoB: RouteBearingInfo,
  entrySideB: EndpointSide,
): boolean {
  const exitBear = getExitBearing(infoA, sideA);
  const entryBear = getEntryBearing(infoB, entrySideB);

  return normalizeBearingDifference(entryBear, exitBear) > BACKTRACKING_THRESHOLD_DEGREES;
}

/**
 * Check if transitioning from routeA to routeB constitutes backtracking, without
 * knowing which way either route is being travelled — the junction is taken to be
 * their closest endpoint pairing.
 */
function isBacktrackingTransition(infoA: RouteBearingInfo, infoB: RouteBearingInfo): boolean {
  const connection = findConnectionEndpoint(infoA, infoB);
  if (!connection) return false;

  return isBacktrackingAt(infoA, connection.sideA, infoB, connection.sideB);
}

/**
 * Check if a route path has any backtracking transitions between consecutive routes.
 */
function hasRoutePathBacktracking(
  path: number[],
  routeInfo: Map<number, RouteBearingInfo>,
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

interface SearchState {
  route: number;
  path: number[];
  exitSide: EndpointSide;
  cost: number;
}

/** Binary min-heap over search states, keyed on cost. */
class SearchQueue {
  private items: SearchState[] = [];

  get size(): number {
    return this.items.length;
  }

  push(state: SearchState) {
    const items = this.items;
    items.push(state);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].cost <= items[i].cost) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): SearchState | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;

    const top = items[0];
    const last = items.pop()!;
    if (items.length === 0) return top;

    items[0] = last;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < items.length && items[left].cost < items[smallest].cost) smallest = left;
      if (right < items.length && items[right].cost < items[smallest].cost) smallest = right;
      if (smallest === i) break;
      [items[smallest], items[i]] = [items[i], items[smallest]];
      i = smallest;
    }
    return top;
  }
}

interface SearchOptions {
  /** Reject transitions that double back on themselves (>140° turn). */
  avoidBacktracking?: boolean;
  /** Give up on paths whose weighted cost exceeds this. */
  maxCost?: number;
}

interface SearchResult {
  path: number[];
  /** Weighted cost, not km — only comparable against other costs from this search. */
  cost: number;
}

/**
 * Dijkstra over the route graph (in-memory).
 *
 * Costs are route length weighted by line_class — highspeed (0.5x), main (1.0x),
 * branch (2.0x) — plus GAP_PENALTY_PER_KM for any gap left between consecutive
 * routes.
 *
 * State is (route, exit endpoint) rather than just the route: traversing a route
 * means entering at one endpoint and leaving at the other, so the next route has
 * to start near where we came out. Without that, paths "teleport" from one end of
 * a route to the other.
 */
function findShortestPath(
  graph: RouteGraph,
  startRoutes: number[],
  endRoutes: number[],
  routeInfo: Map<number, RouteBearingInfo>,
  options: SearchOptions = {},
): SearchResult | null {
  if (startRoutes.length === 0 || endRoutes.length === 0) {
    return null;
  }

  const { avoidBacktracking = false, maxCost = Infinity } = options;
  const endSet = new Set(endRoutes);
  const queue = new SearchQueue();
  const bestCost = new Map<string, number>();

  // Seed with the start routes, traversable in either direction
  for (const route of startRoutes) {
    if (!routeInfo.has(route)) continue;

    for (const exitSide of ENDPOINT_SIDES) {
      const key = `${route}_${exitSide}`;
      if (bestCost.has(key)) continue;
      bestCost.set(key, 0);
      queue.push({ route, path: [route], exitSide, cost: 0 });
    }
  }

  while (queue.size > 0) {
    const current = queue.pop()!;

    // Stale heap entry: a cheaper way to this state was found after it was queued
    const currentBest = bestCost.get(`${current.route}_${current.exitSide}`);
    if (currentBest !== undefined && current.cost > currentBest) continue;

    if (current.cost > maxCost) continue;

    // Dijkstra pops in nondecreasing cost order, so the first end route reached is optimal
    if (endSet.has(current.route)) {
      return { path: current.path, cost: current.cost };
    }

    const currentInfo = routeInfo.get(current.route);
    if (!currentInfo) continue;
    const exitCoord = getEndpointCoord(currentInfo, current.exitSide);

    for (const neighbor of graph.getNeighbors(current.route)) {
      const neighborInfo = routeInfo.get(neighbor);
      if (!neighborInfo) continue;

      // The neighbour has to meet us at the endpoint we came out of
      const entry = resolveEntry(neighborInfo, exitCoord);
      if (!entry) continue;

      // Keep paths elementary — a journey plan listing the same route twice is never useful
      if (current.path.includes(neighbor)) continue;

      // The sides being travelled are known here, so check that exact junction
      // rather than the routes' closest endpoint pairing
      if (
        avoidBacktracking &&
        isBacktrackingAt(currentInfo, current.exitSide, neighborInfo, oppositeSide(entry.exitSide))
      ) {
        continue;
      }

      const newCost =
        current.cost +
        (neighborInfo.length_km ?? 0) * getRouteCostMultiplier(neighborInfo) +
        (entry.gapMeters / 1000) * GAP_PENALTY_PER_KM;
      if (newCost > maxCost) continue;

      const key = `${neighbor}_${entry.exitSide}`;
      const prevBest = bestCost.get(key);
      if (prevBest !== undefined && newCost >= prevBest) continue;

      bestCost.set(key, newCost);
      queue.push({
        route: neighbor,
        path: [...current.path, neighbor],
        exitSide: entry.exitSide,
        cost: newCost,
      });
    }
  }

  return null;
}

/**
 * Get route details for a list of route IDs
 */
async function getRouteDetails(routeIds: number[]): Promise<PlannerRoute[]> {
  if (routeIds.length === 0) return [];

  const client = await pool.connect();
  try {
    const result = await client.query<{
      track_id: number;
      from_station: string;
      to_station: string;
      description: string;
      length_km: string | number;
    }>(
      `
      SELECT track_id, from_station, to_station, description, length_km
      FROM railway_routes
      WHERE track_id = ANY($1)
      ORDER BY array_position($1, track_id)
      `,
      [routeIds],
    );
    // Convert length_km to number (PostgreSQL returns it as string)
    return result.rows.map((row) => {
      const lengthKm =
        typeof row.length_km === "string" ? parseFloat(row.length_km) : row.length_km;
      return {
        track_id: row.track_id,
        from_station: row.from_station,
        to_station: row.to_station,
        description: row.description,
        length_km: lengthKm,
        travelled_length_km: lengthKm,
      };
    });
  } finally {
    client.release();
  }
}

// ============================================================================
// PARTIAL TERMINAL ROUTES
// ============================================================================

/**
 * How much untravelled track a terminal route must be left with before the plan
 * calls it partial.
 *
 * A station projects a few metres inside the route that starts there — its
 * endpoint is a hand-picked click point, not the platform centre — so tiny
 * remainders are noise rather than track the journey misses.
 */
const MIN_UNTRAVELLED_KM = 0.3;

/** The fraction range of a route's geometry that the journey actually covers. */
interface TrimSpec {
  trackId: number;
  lo: number;
  hi: number;
}

function pairKey(trackId: number, stationId: number): string {
  return `${trackId}:${stationId}`;
}

/**
 * Where each station falls along its route, as a 0..1 fraction of the route
 * geometry (0 = the geometry's first point).
 */
async function locateStationsOnRoutes(
  pairs: Array<[trackId: number, stationId: number]>,
): Promise<Map<string, number>> {
  const fractions = new Map<string, number>();
  if (pairs.length === 0) return fractions;

  const result = await pool.query<{ track_id: number; station_id: string | number; frac: number }>(
    `
    SELECT t.track_id, t.station_id, ST_LineLocatePoint(r.geometry, s.coordinates) AS frac
    FROM unnest($1::int[], $2::bigint[]) AS t(track_id, station_id)
    JOIN railway_routes r ON r.track_id = t.track_id
    JOIN stations s ON s.id = t.station_id
    `,
    [pairs.map((p) => p[0]), pairs.map((p) => p[1])],
  );

  for (const row of result.rows) {
    fractions.set(pairKey(row.track_id, Number(row.station_id)), row.frac);
  }
  return fractions;
}

/** Which endpoint of `trackId` faces the route it connects to. */
function connectingSide(
  routeInfo: Map<number, RouteBearingInfo>,
  trackId: number,
  neighborId: number,
): EndpointSide | null {
  const info = routeInfo.get(trackId);
  const neighbor = routeInfo.get(neighborId);
  if (!info || !neighbor) return null;
  return findConnectionEndpoint(info, neighbor)?.sideA ?? null;
}

/**
 * Cut the terminal routes of a path down to the stretch the journey covers.
 *
 * Intermediate routes are always covered end to end — the search enters a route
 * at one endpoint and leaves at the other — but the first and last route are
 * joined mid-way whenever the from/to station sits between their endpoints
 * (e.g. Nový Bor, halfway along Jedlová ⟷ Česká Lípa).
 *
 * The covered side is decided by where the path continues: the first route runs
 * from the station to the endpoint it exits through, the last from the endpoint
 * it is entered at to the station.
 */
async function computeTravelledTrims(
  path: number[],
  routeInfo: Map<number, RouteBearingInfo>,
  fromStationId: number,
  toStationId: number,
): Promise<Map<number, { geometry: PartialRouteGeometry; lengthKm: number }>> {
  const trimmed = new Map<number, { geometry: PartialRouteGeometry; lengthKm: number }>();
  if (path.length === 0) return trimmed;

  const firstId = path[0];
  const lastId = path[path.length - 1];
  // A route reached twice (possible across via segments) has no single covered
  // stretch, so leave it whole rather than guess.
  const occursOnce = (id: number) => path.filter((x) => x === id).length === 1;

  const pairs: Array<[number, number]> = [];
  if (path.length === 1) {
    pairs.push([firstId, fromStationId], [firstId, toStationId]);
  } else {
    if (occursOnce(firstId)) pairs.push([firstId, fromStationId]);
    if (occursOnce(lastId)) pairs.push([lastId, toStationId]);
  }
  if (pairs.length === 0) return trimmed;

  const fractions = await locateStationsOnRoutes(pairs);
  const specs: TrimSpec[] = [];

  if (path.length === 1) {
    // Both ends on one route: the covered stretch is the piece between them
    const fromFrac = fractions.get(pairKey(firstId, fromStationId));
    const toFrac = fractions.get(pairKey(firstId, toStationId));
    if (fromFrac !== undefined && toFrac !== undefined) {
      specs.push({
        trackId: firstId,
        lo: Math.min(fromFrac, toFrac),
        hi: Math.max(fromFrac, toFrac),
      });
    }
  } else {
    const fromFrac = fractions.get(pairKey(firstId, fromStationId));
    const exitSide = connectingSide(routeInfo, firstId, path[1]);
    if (fromFrac !== undefined && exitSide) {
      specs.push(
        exitSide === "end"
          ? { trackId: firstId, lo: fromFrac, hi: 1 }
          : { trackId: firstId, lo: 0, hi: fromFrac },
      );
    }

    const toFrac = fractions.get(pairKey(lastId, toStationId));
    const entrySide = connectingSide(routeInfo, lastId, path[path.length - 2]);
    if (toFrac !== undefined && entrySide) {
      specs.push(
        entrySide === "start"
          ? { trackId: lastId, lo: 0, hi: toFrac }
          : { trackId: lastId, lo: toFrac, hi: 1 },
      );
    }
  }

  // Drop trims that leave nothing out, and degenerate ones
  const meaningful = specs.filter((spec) => {
    if (spec.hi - spec.lo <= 0) return false;
    const fullKm = routeInfo.get(spec.trackId)?.length_km ?? 0;
    return fullKm * (1 - (spec.hi - spec.lo)) >= MIN_UNTRAVELLED_KM;
  });
  if (meaningful.length === 0) return trimmed;

  const result = await pool.query<{
    track_id: number;
    lo: number;
    hi: number;
    geojson: string;
    length_km: number;
  }>(
    `
    SELECT
      t.track_id,
      t.lo,
      t.hi,
      ST_AsGeoJSON(ST_LineSubstring(r.geometry, t.lo, t.hi)) AS geojson,
      ST_Length(ST_LineSubstring(r.geometry, t.lo, t.hi)::geography) / 1000 AS length_km
    FROM unnest($1::int[], $2::float8[], $3::float8[]) AS t(track_id, lo, hi)
    JOIN railway_routes r ON r.track_id = t.track_id
    `,
    [meaningful.map((s) => s.trackId), meaningful.map((s) => s.lo), meaningful.map((s) => s.hi)],
  );

  for (const row of result.rows) {
    const parsed = JSON.parse(row.geojson) as { coordinates: [number, number][] };
    if (!parsed.coordinates || parsed.coordinates.length < 2) continue;
    trimmed.set(row.track_id, {
      geometry: {
        track_id: row.track_id,
        // The fractions travel with the geometry: they are what gets stored when
        // the route is logged, so the stretch survives an OSM recalculation
        covered_start: Number(row.lo),
        covered_end: Number(row.hi),
        coordinates: parsed.coordinates,
      },
      lengthKm: Number(row.length_km),
    });
  }

  return trimmed;
}

/**
 * Find the shortest path of routes connecting from -> via -> to stations
 */
export async function findRoutePathBetweenStations(
  fromStationId: number,
  toStationId: number,
  viaStationIds: number[] = [],
): Promise<PathResult> {
  try {
    // Normalized because station ids are bigint-backed: pg hands them back as
    // strings, and they are used as map keys below
    const stationSequence = [fromStationId, ...viaStationIds, toStationId].map(Number);

    const [routesByStation, { graph, routeInfo }] = await Promise.all([
      findRoutesNearStations([...new Set(stationSequence)]),
      getRouteGraph(),
    ]);

    const routeSequence = stationSequence.map((id) => routesByStation.get(id) ?? []);

    // Validate we found routes near all stations
    if (routeSequence[0].length === 0) {
      return { routes: [], totalDistance: 0, error: "No routes found near starting station" };
    }
    if (routeSequence[routeSequence.length - 1].length === 0) {
      return { routes: [], totalDistance: 0, error: "No routes found near ending station" };
    }
    for (let i = 1; i < routeSequence.length - 1; i++) {
      if (routeSequence[i].length === 0) {
        return { routes: [], totalDistance: 0, error: `No routes found near via station ${i}` };
      }
    }

    // Find path sequentially between each pair of stations
    const allSegments: number[][] = [];
    let previousEndRoute: number | null = null;

    for (let i = 0; i < stationSequence.length - 1; i++) {
      let segmentFromRoutes = routeSequence[i];
      const segmentToRoutes = routeSequence[i + 1];

      // Continue from the previous segment's end route if possible
      if (previousEndRoute !== null && segmentFromRoutes.includes(previousEndRoute)) {
        segmentFromRoutes = [previousEndRoute];
      }

      const best = findShortestPath(graph, segmentFromRoutes, segmentToRoutes, routeInfo);

      if (!best) {
        return {
          routes: [],
          totalDistance: 0,
          error: `No path found for segment ${i + 1}. The stations might not be connected by regular-service routes. Try adding via stations to break up the journey.`,
        };
      }

      let segmentPath = best.path;

      // Prefer an alternative of comparable cost that doesn't double back
      if (hasRoutePathBacktracking(segmentPath, routeInfo)) {
        const alternative = findShortestPath(graph, segmentFromRoutes, segmentToRoutes, routeInfo, {
          avoidBacktracking: true,
          maxCost: Math.min(best.cost * 2, best.cost + 20),
        });

        if (alternative) {
          segmentPath = alternative.path;
        }
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

    // Get route details, then cut the terminal routes down to the stretch travelled
    const [routes, trims] = await Promise.all([
      getRouteDetails(path),
      computeTravelledTrims(
        path,
        routeInfo,
        stationSequence[0],
        stationSequence[stationSequence.length - 1],
      ),
    ]);

    for (const route of routes) {
      const trim = trims.get(route.track_id);
      if (!trim) continue;
      route.partial = trim.geometry;
      route.travelled_length_km = trim.lengthKm;
    }

    const totalDistance = routes.reduce((sum, r) => sum + r.travelled_length_km, 0);

    return { routes, totalDistance };
  } catch (error) {
    console.error("Error finding route path:", error);
    return {
      routes: [],
      totalDistance: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
