/**
 * The journey planner's model of the route network: every regular-usage route,
 * endpoints only, and which routes meet which. Pure — `routeGraphCache.ts`
 * loads it from the database, so a test can build one by hand.
 */

import { haversineDistance } from "../geoUtils";

/** A route as the planner's graph holds it: its ends, and what it costs to ride. */
export interface NetworkRoute {
  track_id: number;
  length_km: number;
  line_class: string | null;
  /** First coordinate of route geometry */
  startCoord: [number, number];
  /** Second coordinate of route geometry (near start) — for the bearing there */
  nearStartCoord: [number, number];
  /** Second-to-last coordinate of route geometry (near end) — for the bearing there */
  nearEndCoord: [number, number];
  /** Last coordinate of route geometry */
  endCoord: [number, number];
}

/** Tolerance in meters for matching route endpoints as connected */
export const ENDPOINT_TOLERANCE_METERS = 500;

export type EndpointSide = "start" | "end";

export const ENDPOINT_SIDES: EndpointSide[] = ["start", "end"];

export function getEndpointCoord(info: NetworkRoute, side: EndpointSide): [number, number] {
  return side === "start" ? info.startCoord : info.endCoord;
}

export function oppositeSide(side: EndpointSide): EndpointSide {
  return side === "start" ? "end" : "start";
}

/**
 * In-memory route graph for fast pathfinding
 */
export class RouteGraph {
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
}

/** The graph and the routes it connects, which is what every search runs over. */
export interface RouteNetwork {
  graph: RouteGraph;
  routeInfo: Map<number, NetworkRoute>;
}

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
 * Connect routes whose endpoints are within ENDPOINT_TOLERANCE_METERS of each
 * other.
 *
 * Endpoints are bucketed into a spatial grid so pairing stays roughly linear
 * instead of comparing every route against every other one. The neighbour order
 * follows `routeInfo`'s insertion order, and the search breaks cost ties in it.
 */
export function buildRouteGraph(routeInfo: Map<number, NetworkRoute>): RouteGraph {
  const graph = new RouteGraph();

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

  return graph;
}
