import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type ChainableRoute, journeyChains } from "@/lib/journeyChains";

/** A point `x` tenths of a degree east along latitude 50 (~7km apart), nudged `m` metres. */
const at = (x: number, m = 0): [number, number] => [14 + x * 0.1 + m / 71_500, 50];

let nextId = 1;
/** A route whose geometry runs from point `x0` to `x1`, labelled `from` ↔ `to`. */
function route(
  from: string,
  to: string,
  x0: number | [number, number],
  x1: number | [number, number],
  extra: Partial<ChainableRoute> = {},
): ChainableRoute {
  const point = (x: number | [number, number]) => (typeof x === "number" ? at(x) : x);
  return {
    track_id: nextId++,
    from_station: from,
    to_station: to,
    length_km: 7,
    partial: false,
    ends: [point(x0), point(x1)],
    ...extra,
  };
}

const stops = (routes: ChainableRoute[]) => journeyChains(routes).map((c) => c.stops.join(" – "));

describe("journeyChains", () => {
  test("joins routes into one line, whatever order and way round they were labelled", () => {
    const routes = [
      route("A", "B", 0, 1),
      route("C", "B", 2, 1),
      route("D", "C", 2, 3), // labels the other way round from the geometry
    ];
    assert.deepEqual(stops(routes), ["A – B – C – D"]);
  });

  test("reads the way it was logged: the first-logged route near the start", () => {
    const routes = [route("C", "D", 2, 3), route("B", "C", 1, 2), route("A", "B", 0, 1)];
    assert.deepEqual(stops(routes), ["D – C – B – A"]);
  });

  test("joins endpoints a few tens of metres apart, not ones further", () => {
    const near = [route("A", "B", 0, 1), route("B", "C", at(1, 60), 2)];
    assert.deepEqual(stops(near), ["A – B – C"]);
    const far = [route("A", "B", 0, 1), route("B", "C", at(1, 400), 2)];
    assert.deepEqual(stops(far), ["A – B", "B – C"]);
  });

  test("leaves junctions out where they are passed through", () => {
    const routes = [
      route("A", "B", 0, 1),
      route("B", "B [junction]", 1, at(1, 500)),
      route("B [junction]", "C", at(1, 500), 2),
      route("C", "D", 2, 3),
    ];
    assert.deepEqual(stops(routes), ["A – B – C – D"]);
  });

  test("keeps a junction that ends a chain", () => {
    const routes = [route("A", "B", 0, 1), route("B", "X [north junction]", 1, 2)];
    assert.deepEqual(stops(routes), ["A – B – X [north junction]"]);
  });

  test("names a point by the label its routes share, over a typo", () => {
    const routes = [
      route("A", "Bee", 0, 1),
      route("Bee", "C", 1, 2),
      route("Be", "D", 1, 3), // a branch whose label is misspelt
    ];
    const chains = journeyChains(routes);
    assert.ok(chains.every((c) => !c.stops.includes("Be")));
  });

  test("a branch ridden off the main line is a chain of its own, after it", () => {
    const routes = [
      route("A", "B", 0, 1),
      route("B", "C", 1, 2),
      route("C", "D", 2, 3),
      route("B", "E", 1, [14.1, 50.05]), // a short spur
    ];
    const chains = journeyChains(routes);
    assert.deepEqual(
      chains.map((c) => c.stops.join(" – ")),
      ["A – B – C – D", "B – E"],
    );
    assert.equal(chains[0].lengthKm, 21);
  });

  test("closes a loop", () => {
    const routes = [
      route("A", "B", 0, 1),
      route("B", "C", 1, [14.05, 50.05]),
      route("C", "A", [14.05, 50.05], 0),
    ];
    const [chain, ...rest] = journeyChains(routes);
    assert.equal(rest.length, 0);
    assert.equal(chain.stops.length, 4);
    assert.equal(chain.stops[0], chain.stops[3]);
  });

  test("a ride that ends partway stops the chain there and counts its stretch", () => {
    const routes = [
      route("A", "B", 0, 1),
      // Ridden from B for the first half, towards C
      route("C", "B", 2, 1, { partial: true, covered_start: 0.5, covered_end: 1 }),
      // C – D, logged too, but not reached from B: a separate piece
      route("C", "D", 2, 3),
    ];
    const chains = journeyChains(routes);
    assert.deepEqual(
      chains.map((c) => [c.stops.join(" – "), c.startsPartway, c.endsPartway]),
      [
        ["A – B – C", false, true],
        ["C – D", false, false],
      ],
    );
    assert.equal(chains[0].lengthKm, 10.5);
    assert.equal(chains[0].unknownExtent, false);
  });

  test("a route ticked partial by hand joins as usual and is flagged", () => {
    const routes = [route("A", "B", 0, 1), route("B", "C", 1, 2, { partial: true })];
    const [chain] = journeyChains(routes);
    assert.deepEqual(chain.stops, ["A", "B", "C"]);
    assert.equal(chain.unknownExtent, true);
    assert.equal(chain.lengthKm, 14);
  });

  test("a route with no geometry stands alone, From first", () => {
    const routes = [
      route("A", "B", 0, 1),
      { track_id: 999, from_station: "Route #999", to_station: "gone", ends: null },
    ];
    assert.deepEqual(stops(routes), ["A – B", "Route #999 – gone"]);
  });

  test("a single route reads From → To", () => {
    assert.deepEqual(stops([route("A", "B", 1, 0)]), ["A – B"]);
  });

  test("lists every route once, in chain order", () => {
    const routes = [route("A", "B", 0, 1), route("B", "C", 1, 2), route("X", "Y", 5, 6)];
    const ids = journeyChains(routes).flatMap((c) => c.trackIds);
    assert.deepEqual([...ids].sort(), routes.map((r) => r.track_id).sort());
  });

  test("a route logged late at one end doesn't turn the line round", () => {
    const routes = [
      route("B", "C", 1, 2),
      route("C", "D", 2, 3),
      route("D", "E", 3, 4),
      route("A", "B", 0, 1), // added back by an edit, so logged last
    ];
    assert.deepEqual(stops(routes), ["A – B – C – D – E"]);
  });

  test("a loop off the line reads round, back to where it left it", () => {
    const routes = [
      route("A", "B", 0, 1),
      route("B", "C", 1, 2),
      route("C", "D", 2, [14.25, 50.05]),
      route("D", "B", [14.25, 50.05], 1),
    ];
    const chains = journeyChains(routes);
    assert.equal(chains.length, 1);
    assert.deepEqual(chains[0].stops, ["A", "B", "C", "D", "B"]);
  });

  test("no routes, no chains", () => {
    assert.deepEqual(journeyChains([]), []);
  });
});
