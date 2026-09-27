/**
 * The journey planner's search over the route graph: what a hop costs, which
 * junctions double back, and Dijkstra itself. Pure — it runs over a
 * `RouteNetwork` in memory and touches no database, so it can be exercised on a
 * network built by hand.
 */

import {
  BACKTRACKING_THRESHOLD_DEGREES,
  calculateBearing,
  haversineDistance,
  normalizeBearingDifference,
} from "../geoUtils";
import {
  ENDPOINT_SIDES,
  ENDPOINT_TOLERANCE_METERS,
  type EndpointSide,
  getEndpointCoord,
  type NetworkRoute,
  oppositeSide,
  type RouteNetwork,
} from "./routeGraph";

/**
 * Cost, expressed in km of main line, charged per km of gap left between the
 * endpoints of two consecutive routes.
 *
 * Endpoint coordinates are hand-picked click points, so two routes that really
 * meet still land a few metres apart — hence ENDPOINT_TOLERANCE_METERS. But a junction
 * complex packs several distinct endpoints a few hundred metres apart, all
 * inside that tolerance. Without a penalty the search treats the jump between
 * them as free and skips the short connecting route that actually covers the
 * gap, producing a path with a hole in it. Penalising the gap makes the covered
 * chain cheaper than the jump, while still allowing a jump when nothing covers it.
 */
const GAP_PENALTY_PER_KM = 25;

/**
 * Cost, in km of main line, of changing to another route at a via station
 * rather than carrying on along the one the journey arrived on — on top of the
 * gap between the two, charged at GAP_PENALTY_PER_KM like any other.
 *
 * The gap alone leaves a change free wherever two routes run on top of each
 * other: a parallel line, or a route duplicated and not yet split. There a
 * journey that merely passed through the via would come out as two partial
 * routes instead of one whole one. A few km is enough to settle those ties for
 * the arriving route, and nothing next to the detour it takes to stay on a line
 * that doesn't go where the journey is headed.
 */
const VIA_CHANGE_PENALTY = 5;

/**
 * Cost multiplier for route-level pathfinding based on line_class.
 * Lower = preferred. Main/highspeed routes are preferred over branch routes.
 */
function getRouteCostMultiplier(info: NetworkRoute): number {
  if (info.line_class === "highspeed") return 0.5;
  if (info.line_class === "main") return 1.0;
  return 2.0; // branch or unknown
}

// ============================================================================
// BACKTRACKING DETECTION
// ============================================================================

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
  info: NetworkRoute,
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
function getExitBearing(info: NetworkRoute, side: EndpointSide): number {
  if (side === "end") {
    return calculateBearing(info.nearEndCoord, info.endCoord);
  } else {
    return calculateBearing(info.nearStartCoord, info.startCoord);
  }
}

/**
 * Get the entry bearing of a route at a given endpoint side.
 */
function getEntryBearing(info: NetworkRoute, side: EndpointSide): number {
  if (side === "start") {
    return calculateBearing(info.startCoord, info.nearStartCoord);
  } else {
    return calculateBearing(info.endCoord, info.nearEndCoord);
  }
}

/**
 * Check whether leaving routeA at sideA and entering routeB at entrySideB doubles
 * back: true when the bearing difference at that junction exceeds 140°.
 */
function isBacktrackingAt(
  infoA: NetworkRoute,
  sideA: EndpointSide,
  infoB: NetworkRoute,
  entrySideB: EndpointSide,
): boolean {
  const exitBear = getExitBearing(infoA, sideA);
  const entryBear = getEntryBearing(infoB, entrySideB);

  return normalizeBearingDifference(entryBear, exitBear) > BACKTRACKING_THRESHOLD_DEGREES;
}

/**
 * Check if a found path has any backtracking transitions between consecutive
 * routes. Each junction is checked at the endpoints the search reports it
 * travelled (`sides`), not at the routes' closest endpoint pairing — inside a
 * junction complex the two can differ, and a guessed junction that happens not
 * to double back would skip the `avoidBacktracking` re-search. A side is null
 * only on a single-route path, which has no junction to check.
 */
function hasRoutePathBacktracking(
  { path, sides }: Pick<SearchResult, "path" | "sides">,
  routeInfo: Map<number, NetworkRoute>,
): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const infoA = routeInfo.get(path[i]);
    const infoB = routeInfo.get(path[i + 1]);
    const exitSideA = sides[i];
    const exitSideB = sides[i + 1];
    if (!infoA || !infoB || !exitSideA || !exitSideB) continue;

    if (isBacktrackingAt(infoA, exitSideA, infoB, oppositeSide(exitSideB))) return true;
  }
  return false;
}

// ============================================================================
// PATH FINDING
// ============================================================================

interface SearchState {
  route: number;
  path: number[];
  /**
   * The endpoint each route in `path` is left through, aligned with it — so the
   * last entry is the endpoint this state sits at. Carried rather than inferred
   * afterwards: inside a junction complex several endpoint pairings can sit
   * inside ENDPOINT_TOLERANCE_METERS at once, and the closest need not be the
   * one travelled.
   */
  sides: EndpointSide[];
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

export interface SearchOptions {
  /** Reject transitions that double back on themselves (>140° turn). */
  avoidBacktracking?: boolean;
  /** Give up on paths whose weighted cost exceeds this. */
  maxCost?: number;
  /** Extra cost of starting on each route, by track id (see `changeCosts`). */
  startCosts?: Map<number, number>;
}

export interface SearchResult {
  path: number[];
  /**
   * The endpoint each route in `path` is left through, aligned with it. The last
   * route is left *beyond* the destination — the journey stops at the station
   * partway along it — so its entry side is that entry's opposite. Null where a
   * single route serves both stations and no endpoint is involved at all.
   */
  sides: (EndpointSide | null)[];
  /** Weighted cost, not km — only comparable against other costs from this search. */
  cost: number;
}

/** Where the segment's from/to station sits along each of its terminal routes. */
export interface TerminalFractions {
  /** Fraction along each start route, by track id. */
  from: Map<number, number>;
  /** Fraction along each end route, by track id. */
  to: Map<number, number>;
}

/**
 * Weighted cost of the stretch of `info` between a station at `frac` and the
 * given endpoint — the piece of a terminal route the journey actually rides.
 *
 * A route whose station could not be located on it is charged whole, which is
 * what every terminal route used to cost.
 */
function terminalCost(info: NetworkRoute, frac: number | undefined, side: EndpointSide): number {
  const covered = frac === undefined ? 1 : side === "end" ? 1 - frac : frac;
  return info.length_km * covered * getRouteCostMultiplier(info);
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
 *
 * **The terminal routes are charged for the stretch travelled, not for their
 * whole length.** A from/to station regularly sits mid-route, and the plan is
 * trimmed to the covered stretch afterwards (`planTrims`) — so costing the whole
 * route makes the search pay for track the journey never rides. Seeding at zero
 * instead, as this did, made it worse than symmetric: where a station is served
 * both by a 4 km connector and by a 300 km trunk, starting on the trunk was free,
 * so a path could set off down the wrong line and still look cheapest. Because
 * the end route is now discounted at the moment it is reached, the first one
 * popped is no longer necessarily the best; the search keeps the cheapest finish
 * and runs until nothing queued can beat it.
 */
export function findShortestPath(
  { graph, routeInfo }: RouteNetwork,
  startRoutes: number[],
  endRoutes: number[],
  fractions: TerminalFractions,
  options: SearchOptions = {},
): SearchResult | null {
  if (startRoutes.length === 0 || endRoutes.length === 0) {
    return null;
  }

  const { avoidBacktracking = false, maxCost = Infinity, startCosts } = options;
  const endSet = new Set(endRoutes);
  const queue = new SearchQueue();
  const bestCost = new Map<string, number>();

  // Cheapest complete path found so far. A finish costs less than the state it
  // grows from would as an ordinary hop, so it can't simply be returned on pop.
  const best: { path: number[] | null; sides: (EndpointSide | null)[]; cost: number } = {
    path: null,
    sides: [],
    cost: Infinity,
  };
  const considerFinish = (path: number[], sides: (EndpointSide | null)[], cost: number) => {
    if (cost > maxCost || cost >= best.cost) return;
    best.path = path;
    best.sides = sides;
    best.cost = cost;
  };

  // Seed with the start routes, traversable in either direction
  for (const route of startRoutes) {
    const info = routeInfo.get(route);
    if (!info) continue;
    const fromFrac = fractions.from.get(route);
    const startCost = startCosts?.get(route) ?? 0;

    // Both stations on one route: the journey is the stretch between them, and
    // there is nothing to search — an end route is never travelled through
    if (endSet.has(route)) {
      const toFrac = fractions.to.get(route);
      const covered =
        fromFrac !== undefined && toFrac !== undefined ? Math.abs(toFrac - fromFrac) : 1;
      considerFinish(
        [route],
        [null],
        startCost + info.length_km * covered * getRouteCostMultiplier(info),
      );
      continue;
    }

    for (const exitSide of ENDPOINT_SIDES) {
      const key = `${route}_${exitSide}`;
      const cost = startCost + terminalCost(info, fromFrac, exitSide);
      const prevBest = bestCost.get(key);
      if (prevBest !== undefined && cost >= prevBest) continue;
      bestCost.set(key, cost);
      queue.push({ route, path: [route], sides: [exitSide], cost });
    }
  }

  while (queue.size > 0) {
    const current = queue.pop()!;

    // Dijkstra pops in nondecreasing cost order, so once the queue's cheapest
    // state costs as much as the best finish, nothing left can improve on it
    if (best.path !== null && current.cost >= best.cost) break;

    const currentExitSide = current.sides[current.sides.length - 1];

    // Stale heap entry: a cheaper way to this state was found after it was queued
    const currentBest = bestCost.get(`${current.route}_${currentExitSide}`);
    if (currentBest !== undefined && current.cost > currentBest) continue;

    if (current.cost > maxCost) continue;

    const currentInfo = routeInfo.get(current.route);
    if (!currentInfo) continue;
    const exitCoord = getEndpointCoord(currentInfo, currentExitSide);

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
        isBacktrackingAt(currentInfo, currentExitSide, neighborInfo, oppositeSide(entry.exitSide))
      ) {
        continue;
      }

      const gapCost = (entry.gapMeters / 1000) * GAP_PENALTY_PER_KM;

      // The journey ends at the to-station, which is usually partway along the
      // end route: charge only the stretch from the endpoint entered to it, and
      // don't search on — a route reaching the destination is the destination
      if (endSet.has(neighbor)) {
        considerFinish(
          [...current.path, neighbor],
          [...current.sides, entry.exitSide],
          current.cost +
            gapCost +
            terminalCost(neighborInfo, fractions.to.get(neighbor), oppositeSide(entry.exitSide)),
        );
        continue;
      }

      const newCost =
        current.cost + neighborInfo.length_km * getRouteCostMultiplier(neighborInfo) + gapCost;
      if (newCost > maxCost) continue;

      const key = `${neighbor}_${entry.exitSide}`;
      const prevBest = bestCost.get(key);
      if (prevBest !== undefined && newCost >= prevBest) continue;

      bestCost.set(key, newCost);
      queue.push({
        route: neighbor,
        path: [...current.path, neighbor],
        sides: [...current.sides, entry.exitSide],
        cost: newCost,
      });
    }
  }

  return best.path === null ? null : { path: best.path, sides: best.sides, cost: best.cost };
}

/**
 * The best path for one segment of a journey — between two consecutive stops —
 * preferring an alternative of comparable cost that doesn't double back.
 *
 * "Comparable" is twice the cost or +20, whichever is smaller. Null when the two
 * stops are not connected at all.
 */
export function searchSegment(
  network: RouteNetwork,
  fromRoutes: number[],
  toRoutes: number[],
  fractions: TerminalFractions,
  startCosts?: Map<number, number>,
): SearchResult | null {
  const best = findShortestPath(network, fromRoutes, toRoutes, fractions, { startCosts });
  if (!best || !hasRoutePathBacktracking(best, network.routeInfo)) return best;

  const alternative = findShortestPath(network, fromRoutes, toRoutes, fractions, {
    avoidBacktracking: true,
    maxCost: Math.min(best.cost * 2, best.cost + 20),
    startCosts,
  });
  return alternative ?? best;
}

/**
 * What starting the segment after a via on each of the via's routes costs, given
 * the route the journey arrived on: nothing to carry on along it, and for any
 * other the gap between the two where they pass the station — charged at
 * GAP_PENALTY_PER_KM, exactly as a gap between two routes inside a segment is —
 * plus VIA_CHANGE_PENALTY.
 *
 * `points` is the point on each route nearest the via, by track id. Without the
 * gap, a via would be a free jump between any two routes matched to it: the
 * progressive tolerance in `findRoutesNearStations` can take in a route hundreds
 * of metres off, or kilometres where nothing is closer, and a change there would
 * join two lines at a place they never meet. A route with no known point near the
 * via (none should be) is charged as if it were a tolerance away.
 */
export function changeCosts(
  arrivedOn: number,
  viaRoutes: number[],
  points: Map<number, [number, number]>,
): Map<number, number> {
  const arrivalPoint = points.get(arrivedOn);
  return new Map(
    viaRoutes.map((trackId) => {
      if (trackId === arrivedOn) return [trackId, 0];
      const point = points.get(trackId);
      const gapMeters =
        arrivalPoint && point ? haversineDistance(arrivalPoint, point) : ENDPOINT_TOLERANCE_METERS;
      return [trackId, VIA_CHANGE_PENALTY + (gapMeters / 1000) * GAP_PENALTY_PER_KM];
    }),
  );
}
