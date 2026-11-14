/**
 * A journey's routes as the lines of stations they were ridden along — "Praha –
 * Beroun – Plzeň" rather than a list of From ↔ To boxes.
 *
 * A journey stores no order, and its routes don't share labels reliably enough to
 * be joined by name: From and To are interchangeable, so a label says nothing of
 * which end of the geometry it sits at. Routes are joined by geometry instead, an
 * endpoint within `JOIN_DISTANCE_M` of another being the same point (two routes
 * picked at one station end a few metres apart, as they are click points rather
 * than shared nodes). The labels then only name the points: at each, the label the
 * routes meeting there have in common.
 *
 * The graph is cut into chains by repeatedly taking its longest path: the main
 * line of the journey first, then whatever hangs off it (a branch ridden out and
 * back, a second way between two stations). Junctions are left out of a chain
 * except at its ends, where nothing else names the point.
 */

import { haversineDistance } from "./geoUtils";
import { foldForSearch } from "./searchText";
import { coverageToleranceFraction } from "./shared/routeCoverage";

/** What a chain needs of a logged route. `ends` missing: a route the map no longer has. */
export interface ChainableRoute {
  track_id: number;
  from_station: string;
  to_station: string;
  length_km?: number | string | null;
  partial?: boolean | null;
  covered_start?: number | null;
  covered_end?: number | null;
  /** The geometry's first and last point, [lng, lat]. */
  ends?: [[number, number], [number, number]] | null;
}

export interface JourneyChain {
  /** The stations in riding order. At least two. */
  stops: string[];
  /** The first or last stop was not reached: the ride began or ended partway along the route. */
  startsPartway: boolean;
  endsPartway: boolean;
  /** Its routes, in order along it. */
  trackIds: number[];
  /** What was travelled: a known partial stretch counts its own length. */
  lengthKm: number;
  /**
   * One of its routes was ticked partial by hand, with no known stretch, and is
   * counted whole in `lengthKm` (the rule `LOGGED_KM_SQL` follows).
   */
  unknownExtent: boolean;
}

/**
 * Endpoints this close are one point. Routes meeting at a station end within a few
 * tens of metres of each other; the furthest apart found across a full journey log
 * were ~60m. Stations, even neighbouring ones, are much further apart than this.
 */
export const JOIN_DISTANCE_M = 150;

/** A junction, a loop, any point named by its place and a bracketed note. */
const BRACKETED = /\s*\[[^\]]*\]\s*$/;
const isBracketed = (name: string) => BRACKETED.test(name);

/** How much of a route the journey travelled, by the Route Logger's rule. */
function travelledKm(route: ChainableRoute): number {
  const length = Number(route.length_km ?? 0) || 0;
  const { partial, covered_start: start, covered_end: end } = route;
  return partial && start != null && end != null ? (end - start) * length : length;
}

interface Edge {
  route: ChainableRoute;
  /** Position in the journey's log, which is roughly riding order. */
  index: number;
  /** Nodes at the geometry's start and end. */
  a: number;
  b: number;
  /** The labels at `a` and at `b`, once oriented. */
  labelA: string;
  labelB: string;
  /** The end at that node was not reached (a partial ride of known extent). */
  partwayA: boolean;
  partwayB: boolean;
}

export function journeyChains(routes: ChainableRoute[]): JourneyChain[] {
  if (routes.length === 0) return [];

  // Two node slots per route, start and end; joined below. An end the ride never
  // reached joins nothing, so a chain stops there rather than running on into a
  // route ridden from the other side.
  const parent = routes.flatMap((_, i) => [2 * i, 2 * i + 1]);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const reached = routes.map((route) => {
    const { partial, covered_start: start, covered_end: end } = route;
    if (!partial || start == null || end == null) return [true, true];
    const tolerance = coverageToleranceFraction(Number(route.length_km)) || 0.01;
    return [start <= tolerance, end >= 1 - tolerance];
  });
  const points: { slot: number; point: [number, number] }[] = [];
  routes.forEach((route, i) => {
    if (!route.ends) return;
    if (reached[i][0]) points.push({ slot: 2 * i, point: route.ends[0] });
    if (reached[i][1]) points.push({ slot: 2 * i + 1, point: route.ends[1] });
  });
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (haversineDistance(points[i].point, points[j].point) <= JOIN_DISTANCE_M) {
        parent[find(points[i].slot)] = find(points[j].slot);
      }
    }
  }

  const edges: Edge[] = routes.map((route, index) => ({
    route,
    index,
    a: find(2 * index),
    b: find(2 * index + 1),
    labelA: route.from_station,
    labelB: route.to_station,
    partwayA: !reached[index][0],
    partwayB: !reached[index][1],
  }));

  // Which label sits at which end: the way round that agrees with more of the
  // labels the other routes have at those points. With no say either way (a route
  // on its own, or a typo), From stays at the geometry's start.
  const atNode = new Map<number, Edge[]>();
  for (const edge of edges) {
    for (const node of new Set([edge.a, edge.b])) {
      atNode.set(node, [...(atNode.get(node) ?? []), edge]);
    }
  }
  const folded = new Map<string, string>();
  const fold = (name: string) => {
    let key = folded.get(name);
    if (key === undefined) {
      key = foldForSearch(name);
      folded.set(name, key);
    }
    return key;
  };
  const agreement = (node: number, label: string, self: Edge) =>
    (atNode.get(node) ?? []).filter(
      (other) =>
        other !== self &&
        (fold(other.route.from_station) === fold(label) ||
          fold(other.route.to_station) === fold(label)),
    ).length;
  for (const edge of edges) {
    const { from_station: from, to_station: to } = edge.route;
    const asIs = agreement(edge.a, from, edge) + agreement(edge.b, to, edge);
    const swapped = agreement(edge.a, to, edge) + agreement(edge.b, from, edge);
    if (swapped > asIs) {
      edge.labelA = to;
      edge.labelB = from;
    }
  }

  // A point's name: the label most of its routes give it, a station's over a
  // junction's where they differ
  const votes = new Map<number, Map<string, number>>();
  for (const edge of edges) {
    for (const [node, label] of [
      [edge.a, edge.labelA],
      [edge.b, edge.labelB],
    ] as const) {
      const tally = votes.get(node) ?? new Map<string, number>();
      tally.set(label, (tally.get(label) ?? 0) + 1);
      votes.set(node, tally);
    }
  }
  const nameOf = (node: number): string => {
    const ranked = [...(votes.get(node) ?? [])].sort((x, y) => y[1] - x[1]);
    return (ranked.find(([label]) => !isBracketed(label)) ?? ranked[0])[0];
  };

  const chains: { edges: Edge[]; nodes: number[] }[] = [];
  const left = new Set(edges);
  while (left.size > 0) {
    const path = longestPath(left);
    for (const edge of path.edges) left.delete(edge);
    chains.push(path);
  }

  return chains
    .map(({ edges: chainEdges, nodes }) => {
      // Read the way it was logged: the way its routes' log positions mostly rise.
      // Not just its two ends, as a route logged later (an edit adding one back)
      // can sit at either.
      const rises = chainEdges.reduce(
        (sum, edge, i) => (i === 0 ? 0 : sum + Math.sign(edge.index - chainEdges[i - 1].index)),
        0,
      );
      const reversed =
        rises < 0 || (rises === 0 && chainEdges[0].index > chainEdges[chainEdges.length - 1].index);
      const ordered = reversed ? [...chainEdges].reverse() : chainEdges;
      const orderedNodes = reversed ? [...nodes].reverse() : nodes;
      // A single route reads From → To, as the admin labelled it
      if (ordered.length === 1) {
        const [edge] = ordered;
        const firstLabel = orderedNodes[0] === edge.a ? edge.labelA : edge.labelB;
        if (firstLabel !== edge.route.from_station) orderedNodes.reverse();
      }
      const partwayAt = (edge: Edge, node: number) =>
        edge.a === edge.b ? false : node === edge.a ? edge.partwayA : edge.partwayB;
      const first = orderedNodes[0];
      const last = orderedNodes[orderedNodes.length - 1];
      return {
        firstIndex: Math.min(...ordered.map((e) => e.index)),
        chain: {
          stops: stopNames(orderedNodes.map(nameOf)),
          startsPartway: partwayAt(ordered[0], first),
          endsPartway: partwayAt(ordered[ordered.length - 1], last),
          trackIds: ordered.map((e) => e.route.track_id),
          lengthKm: ordered.reduce((sum, e) => sum + travelledKm(e.route), 0),
          unknownExtent: ordered.some(
            (e) =>
              e.route.partial && (e.route.covered_start == null || e.route.covered_end == null),
          ),
        },
      };
    })
    .sort((x, y) => x.firstIndex - y.firstIndex)
    .map(({ chain }) => chain);

  /**
   * A chain's stop names: junctions passed through are left out, and so is a name
   * repeated back to back once they are (a station and its junction).
   */
  function stopNames(names: string[]): string[] {
    const kept = names.filter((name, i) => i === 0 || i === names.length - 1 || !isBracketed(name));
    const place = (name: string) => fold(name.replace(BRACKETED, ""));
    const stops = kept.filter((name, i) => i === 0 || place(name) !== place(kept[i - 1]));
    // A route between a station and its own junction still has two ends
    return stops.length >= 2 ? stops : kept.slice(0, 1).concat(kept.slice(-1));
  }
}

/**
 * The longest path through `edges` by length travelled, as edges and the nodes
 * along it. Exact on a tree (two sweeps, each from the far end of the last), which
 * a journey almost always is. Where it ends one route short of a station it
 * already passed, the route is taken too, so a loop reads round to where it began
 * ("… Nýřany – Plzeň" back into Plzeň) rather than as a line of its own.
 */
function longestPath(edges: Set<Edge>): { edges: Edge[]; nodes: number[] } {
  const adjacent = new Map<number, { edge: Edge; to: number }[]>();
  for (const edge of edges) {
    adjacent.set(edge.a, [...(adjacent.get(edge.a) ?? []), { edge, to: edge.b }]);
    if (edge.b !== edge.a) {
      adjacent.set(edge.b, [...(adjacent.get(edge.b) ?? []), { edge, to: edge.a }]);
    }
  }

  const farthest = (start: number) => {
    let best = { km: -1, edges: [] as Edge[], nodes: [start] };
    const seen = new Set([start]);
    const walk = (node: number, km: number, path: Edge[], nodes: number[]) => {
      if (km > best.km) best = { km, edges: [...path], nodes: [...nodes] };
      for (const { edge, to } of adjacent.get(node) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        path.push(edge);
        nodes.push(to);
        walk(to, km + travelledKm(edge.route), path, nodes);
        path.pop();
        nodes.pop();
      }
    };
    walk(start, 0, [], [start]);
    return best;
  };

  // Seeded from the earliest-logged edge left, so the outcome doesn't hang on the
  // Set's order; one sweep finds a far end, the second the path from it
  const seed = [...edges].reduce((x, y) => (y.index < x.index ? y : x));
  const end = farthest(seed.a).nodes.at(-1) ?? seed.a;
  const path = farthest(end);
  if (path.edges.length === 0) {
    // Only a route that starts and ends at one point is left
    return { edges: [seed], nodes: [seed.a, seed.b] };
  }
  const onPath = new Set(path.nodes);
  const back = (node: number) =>
    (adjacent.get(node) ?? []).find(({ edge, to }) => onPath.has(to) && !path.edges.includes(edge));
  const atEnd = back(path.nodes[path.nodes.length - 1]);
  const atStart = atEnd ? undefined : back(path.nodes[0]);
  if (atEnd) {
    path.edges.push(atEnd.edge);
    path.nodes.push(atEnd.to);
  } else if (atStart) {
    path.edges.unshift(atStart.edge);
    path.nodes.unshift(atStart.to);
  }
  return { edges: path.edges, nodes: path.nodes };
}
