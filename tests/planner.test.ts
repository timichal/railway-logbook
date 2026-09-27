import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildRouteGraph, type NetworkRoute, type RouteNetwork } from "@/lib/planner/routeGraph";
import {
  changeCosts,
  findShortestPath,
  type SearchResult,
  searchSegment,
  type TerminalFractions,
} from "@/lib/planner/routeSearch";
import { planTrims, planVisits, type RouteVisit } from "@/lib/planner/routeVisits";
import type { StationRouteMatch } from "@/lib/planner/stations";

type Coord = [number, number];

/**
 * A route of a given length between two points. Only its ends matter to the
 * planner; the near-end coordinates, which set the bearing at each end, default
 * to a point a tenth of the way along the straight line between them.
 */
function route(
  track_id: number,
  length_km: number,
  startCoord: Coord,
  endCoord: Coord,
  options: { line_class?: string; nearStart?: Coord; nearEnd?: Coord } = {},
): NetworkRoute {
  const along = (from: Coord, to: Coord): Coord => [
    from[0] + (to[0] - from[0]) * 0.1,
    from[1] + (to[1] - from[1]) * 0.1,
  ];
  return {
    track_id,
    length_km,
    line_class: options.line_class ?? "main",
    startCoord,
    endCoord,
    nearStartCoord: options.nearStart ?? along(startCoord, endCoord),
    nearEndCoord: options.nearEnd ?? along(endCoord, startCoord),
  };
}

function network(...routes: NetworkRoute[]): RouteNetwork {
  const routeInfo = new Map(routes.map((r) => [r.track_id, r]));
  return { graph: buildRouteGraph(routeInfo), routeInfo };
}

const byTrackId = (entries: Record<number, number>) =>
  new Map(Object.entries(entries).map(([id, frac]) => [Number(id), frac]));

const fractions = (
  from: Record<number, number>,
  to: Record<number, number>,
): TerminalFractions => ({ from: byTrackId(from), to: byTrackId(to) });

// Points along latitude 50, 0.1° of longitude (~7km) apart
const P0: Coord = [14.0, 50.0];
const P1: Coord = [14.1, 50.0];
const P2: Coord = [14.2, 50.0];
const P3: Coord = [14.3, 50.0];

describe("buildRouteGraph", () => {
  test("connects routes whose endpoints are within 500m, both ways", () => {
    const { graph } = network(
      route(1, 7, P0, P1),
      route(2, 7, [14.1004, 50.0], P2), // ~30m off
      route(3, 7, [14.1, 50.0055], P3), // ~610m off
    );
    assert.deepEqual(graph.getNeighbors(1), [2]);
    assert.deepEqual(graph.getNeighbors(2), [1]);
    assert.deepEqual(graph.getNeighbors(3), []);
  });

  test("pairs across grid cells at high latitude", () => {
    // 0.008° of longitude is ~140m at 81°N
    const { graph } = network(
      route(1, 5, [10.0, 81.0], [20.0, 81.0]),
      route(2, 5, [20.008, 81.0], [30.0, 81.0]),
    );
    assert.deepEqual(graph.getNeighbors(1), [2]);
  });
});

describe("findShortestPath", () => {
  test("rides a chain, charging only the travelled stretch of the terminal routes", () => {
    const net = network(route(1, 7, P0, P1), route(2, 7, P1, P2), route(3, 7, P2, P3));
    const result = findShortestPath(net, [1], [3], fractions({ 1: 0.5 }, { 3: 0.5 }));
    assert.deepEqual(result, { path: [1, 2, 3], sides: ["end", "end", "end"], cost: 14 });
  });

  test("reports the endpoint each route is left through, whichever way it is stored", () => {
    const net = network(route(1, 7, P0, P1), route(2, 7, P2, P1), route(3, 7, P3, P2));
    const result = findShortestPath(net, [1], [3], fractions({ 1: 0.5 }, { 3: 0.5 }));
    assert.deepEqual(result?.path, [1, 2, 3]);
    assert.deepEqual(result?.sides, ["end", "start", "start"]);
  });

  test("both stations on one route: the stretch between them", () => {
    const net = network(route(1, 10, P0, P1));
    const result = findShortestPath(net, [1], [1], fractions({ 1: 0.2 }, { 1: 0.7 }));
    assert.ok(result);
    assert.deepEqual(result.path, [1]);
    assert.deepEqual(result.sides, [null]);
    assert.ok(Math.abs(result.cost - 5) < 1e-9);
  });

  test("prefers a main line to a shorter branch", () => {
    const north: Coord = [14.15, 50.1];
    const south: Coord = [14.15, 49.9];
    const net = network(
      route(1, 7, P0, P1),
      route(2, 10, P1, north, { line_class: "branch" }), // costs 20
      route(3, 15, P1, south), // costs 15
      route(4, 10, north, P2, { line_class: "branch" }),
      route(5, 15, south, P2),
      route(6, 7, P2, P3),
    );
    const result = findShortestPath(net, [1], [6], fractions({ 1: 0 }, { 6: 1 }));
    assert.deepEqual(result?.path, [1, 3, 5, 6]);
  });

  test("takes the connector across a junction rather than jumping the gap", () => {
    const across: Coord = [14.1056, 50.0]; // ~400m on
    const net = network(
      route(1, 7, P0, P1),
      route(2, 0.4, P1, across), // costs 0.4; the jump would cost 10
      route(3, 7, across, P2),
    );
    const result = findShortestPath(net, [1], [3], fractions({ 1: 0 }, { 3: 1 }));
    assert.deepEqual(result?.path, [1, 2, 3]);
  });

  test("keeps searching past the first finish for a cheaper one", () => {
    // The destination sits near route 2's start. Hopping onto it directly enters
    // at its end and rides 90km of it; the detour over route 3 enters at the start
    const q: Coord = [14.1, 50.2];
    const net = network(route(1, 7, P0, P1), route(2, 100, q, P1), route(3, 20, P1, q));
    const result = findShortestPath(net, [1], [2], fractions({ 1: 0 }, { 2: 0.1 }));
    assert.deepEqual(result, { path: [1, 3, 2], sides: ["end", "end", "end"], cost: 37 });
  });

  test("a start cost is added to the route it applies to", () => {
    const net = network(route(1, 7, P0, P1), route(2, 7, P0, P1), route(3, 7, P1, P2));
    // Routes 1 and 2 lie side by side, and the journey starts where both meet route 3
    const result = findShortestPath(net, [1, 2], [3], fractions({ 1: 1, 2: 1 }, { 3: 1 }), {
      startCosts: new Map([[1, 3]]),
    });
    assert.deepEqual(result, { path: [2, 3], sides: ["end", "end"], cost: 7 });
  });

  test("no path, no result", () => {
    const net = network(route(1, 7, P0, P1), route(2, 7, P2, P3));
    assert.equal(findShortestPath(net, [1], [2], fractions({}, {})), null);
    assert.equal(findShortestPath(net, [], [2], fractions({}, {})), null);
  });

  test("gives up beyond maxCost", () => {
    const net = network(route(1, 7, P0, P1), route(2, 7, P1, P2), route(3, 7, P2, P3));
    const f = fractions({ 1: 0 }, { 3: 1 });
    assert.equal(findShortestPath(net, [1], [3], f, { maxCost: 20 }), null);
    assert.equal(findShortestPath(net, [1], [3], f, { maxCost: 21 })?.cost, 21);
  });
});

describe("searchSegment", () => {
  // Route 1 runs east into J. From J, route 2 doubles straight back
  // west-north-west to K; routes 3 and 4 loop round to K without turning back.
  // Route 5 leaves K northward.
  const J = P1;
  const K: Coord = [14.05, 50.01];
  const L: Coord = [14.2, 50.05];
  const loop = (route3Km: number) =>
    network(
      route(1, 7, P0, J),
      route(2, 4, J, K),
      route(3, route3Km, J, L, { nearStart: [14.11, 50.0], nearEnd: [14.2, 50.04] }),
      route(4, 4, L, K, { nearStart: [14.19, 50.051], nearEnd: [14.06, 50.005] }),
      route(5, 10, K, [14.05, 50.1]),
    );
  const f = fractions({ 1: 0.5 }, { 5: 0.5 });

  test("the plain search takes the shortcut that doubles back", () => {
    assert.deepEqual(findShortestPath(loop(4), [1], [5], f)?.path, [1, 2, 5]);
  });

  test("prefers a comparable path that does not double back", () => {
    assert.deepEqual(searchSegment(loop(4), [1], [5], f)?.path, [1, 3, 4, 5]);
  });

  test("keeps the doubling-back path when the alternative costs too much more", () => {
    assert.deepEqual(searchSegment(loop(30), [1], [5], f)?.path, [1, 2, 5]);
  });
});

describe("changeCosts", () => {
  test("carrying on is free, changing costs the gap plus a penalty", () => {
    const points = new Map<number, Coord>([
      [1, [14.0, 50.0]],
      [2, [14.0, 50.0]],
      [3, [14.0, 50.0009]], // ~100m away
    ]);
    const costs = changeCosts(1, [1, 2, 3, 4], points);
    assert.equal(costs.get(1), 0);
    assert.equal(costs.get(2), 5);
    assert.ok(Math.abs(costs.get(3)! - (5 + 0.1 * 25)) < 0.01);
    // No known point: charged as if a whole tolerance away
    assert.equal(costs.get(4), 5 + 0.5 * 25);
  });
});

/** Stations by id, each with its fraction along the routes it serves. */
function stationsAt(entries: Record<number, Record<number, number>>) {
  const stations = new Map<number, StationRouteMatch>();
  for (const [stationId, byRoute] of Object.entries(entries)) {
    const fracs = byTrackId(byRoute);
    stations.set(Number(stationId), {
      routes: [...fracs.keys()],
      fractions: fracs,
      points: new Map(),
    });
  }
  return stations;
}

const segment = (path: number[], sides: SearchResult["sides"]): SearchResult => ({
  path,
  sides,
  cost: 0,
});

describe("planVisits", () => {
  test("terminal routes run from their station, intermediate ones end to end", () => {
    const visits = planVisits(
      [segment([1, 2, 3], ["end", "end", "end"])],
      [100, 200],
      stationsAt({ 100: { 1: 0.5 }, 200: { 3: 0.25 } }),
    );
    assert.deepEqual(visits, [
      { trackId: 1, fracs: [0.5, 1] },
      { trackId: 2, fracs: [0, 1] },
      { trackId: 3, fracs: [0, 0.25] },
    ]);
  });

  test("a route travelled against its geometry is entered at its end", () => {
    const visits = planVisits(
      [segment([1, 2, 3], ["end", "start", "start"])],
      [100, 200],
      stationsAt({ 100: { 1: 0.5 }, 200: { 3: 0.25 } }),
    );
    assert.deepEqual(visits, [
      { trackId: 1, fracs: [0.5, 1] },
      { trackId: 2, fracs: [1, 0] },
      { trackId: 3, fracs: [1, 0.25] },
    ]);
  });

  test("a single-route segment touches only its two stations", () => {
    const visits = planVisits(
      [segment([1], [null])],
      [100, 200],
      stationsAt({ 100: { 1: 0.2 }, 200: { 1: 0.7 } }),
    );
    assert.deepEqual(visits, [{ trackId: 1, fracs: [0.2, 0.7] }]);
  });

  test("carrying on through a via merges the two segments' visits", () => {
    const visits = planVisits(
      [segment([1, 2], ["end", "end"]), segment([2, 3], ["end", "end"])],
      [100, 150, 200],
      stationsAt({ 100: { 1: 0.5 }, 150: { 2: 0.4 }, 200: { 3: 0.5 } }),
    );
    assert.deepEqual(visits, [
      { trackId: 1, fracs: [0.5, 1] },
      { trackId: 2, fracs: [0, 0.4, 0.4, 1] },
      { trackId: 3, fracs: [0, 0.5] },
    ]);
  });

  test("changing lines at a via leaves one route there and joins the next", () => {
    const visits = planVisits(
      [segment([1, 2], ["end", "end"]), segment([3], [null])],
      [100, 150, 200],
      stationsAt({ 100: { 1: 0.5 }, 150: { 2: 0.4, 3: 0.6 }, 200: { 3: 0.9 } }),
    );
    assert.deepEqual(visits, [
      { trackId: 1, fracs: [0.5, 1] },
      { trackId: 2, fracs: [0, 0.4] },
      { trackId: 3, fracs: [0.6, 0.9] },
    ]);
  });

  test("a stop that could not be located on its route is left undefined", () => {
    const visits = planVisits([segment([1], [null])], [100, 200], stationsAt({ 100: {} }));
    assert.deepEqual(visits, [{ trackId: 1, fracs: [undefined, undefined] }]);
  });
});

describe("planTrims", () => {
  const tenKm = new Map([1, 2, 3].map((id) => [id, route(id, 10, P0, P1)]));

  test("trims the routes joined at a stop and leaves the rest whole", () => {
    const visits: RouteVisit[] = [
      { trackId: 1, fracs: [0.5, 1] },
      { trackId: 2, fracs: [0, 1] },
      { trackId: 3, fracs: [1, 0.25] },
    ];
    assert.deepEqual(planTrims(visits, tenKm), {
      trims: [
        { trackId: 1, lo: 0.5, hi: 1 },
        { trackId: 3, lo: 0.25, hi: 1 },
      ],
      untravelled: new Set(),
    });
  });

  test("less than 0.3km left over is not a trim", () => {
    const visits: RouteVisit[] = [
      { trackId: 1, fracs: [0.02, 1] }, // 0.2km left
      { trackId: 2, fracs: [0, 0.96] }, // 0.4km left
    ];
    assert.deepEqual(planTrims(visits, tenKm).trims, [{ trackId: 2, lo: 0, hi: 0.96 }]);
  });

  test("a route barely entered is untravelled rather than trimmed", () => {
    const visits: RouteVisit[] = [
      { trackId: 1, fracs: [0.99, 1] }, // 0.1km ridden
      { trackId: 2, fracs: [0, 0.5] },
    ];
    const { trims, untravelled } = planTrims(visits, tenKm);
    assert.deepEqual(trims, [{ trackId: 2, lo: 0, hi: 0.5 }]);
    assert.deepEqual(untravelled, new Set([1]));
  });

  test("a route visited twice, or with a stop not located on it, stays whole", () => {
    const visits: RouteVisit[] = [
      { trackId: 1, fracs: [0.5, 1] },
      { trackId: 2, fracs: [0, 1] },
      { trackId: 1, fracs: [1, 0.2] },
      { trackId: 3, fracs: [0, undefined] },
    ];
    assert.deepEqual(planTrims(visits, tenKm), { trims: [], untravelled: new Set() });
  });

  test("a single-route out-and-back covers the span of its stops", () => {
    const visits: RouteVisit[] = [{ trackId: 1, fracs: [0.2, 0.6, 0.6, 0.2] }];
    assert.deepEqual(planTrims(visits, tenKm).trims, [{ trackId: 1, lo: 0.2, hi: 0.6 }]);
  });

  test("a single-route plan is untravelled only when every stop is one point", () => {
    assert.deepEqual(planTrims([{ trackId: 1, fracs: [0.5, 0.51] }], tenKm).trims, [
      { trackId: 1, lo: 0.5, hi: 0.51 },
    ]);
    assert.deepEqual(planTrims([{ trackId: 1, fracs: [0.5, 0.5] }], tenKm), {
      trims: [],
      untravelled: new Set([1]),
    });
  });
});
