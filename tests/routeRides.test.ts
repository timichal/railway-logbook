import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createExpression,
  type ExpressionSpecification,
  type FilterSpecification,
  featureFilter,
  latest,
} from "@maplibre/maplibre-gl-style-spec";
import { REGULAR_ROUTE_LAYER_ID, ROUTE_CLICK_LAYER_ID } from "@/lib/shared/map/layers";
import {
  indexRides,
  keepWithProvisional,
  NO_RIDES,
  provisionalRides,
  type RouteRide,
  ridesRetryDelayMs,
  sameRides,
} from "@/lib/shared/map/routeRides";
import { routeColors } from "@/lib/shared/map/style";
import { createUserMapLayers, userRouteLayerConfigs } from "@/lib/shared/map/userMapLayers";
import {
  getUserRouteColorExpression,
  getUserRouteSortKeyExpression,
} from "@/lib/shared/map/utils/userRouteStyling";

const ride = (track_id: number, whole: boolean, closed = false): RouteRide => ({
  track_id,
  whole,
  closed,
  date: "2024-05-01",
  journey_name: "Trip",
});

/** A route tile feature, as an expression sees it. */
const feature = (id: number, properties: Record<string, unknown> = {}) => ({
  type: "LineString" as const,
  id,
  properties: { line_class: "main", usage_type: 0, closed: false, ...properties },
});

function evaluate(
  expression: ExpressionSpecification | number,
  propertySpec: object,
  id: number,
  properties?: Record<string, unknown>,
): unknown {
  const compiled = createExpression(expression, propertySpec as never);
  if (compiled.result !== "success") {
    throw new Error(`Invalid expression: ${JSON.stringify(compiled.value)}`);
  }
  return compiled.value.evaluate({ zoom: 6 }, feature(id, properties) as never);
}

const colorOf = (expression: ExpressionSpecification, id: number, lineClass = "main") =>
  String(evaluate(expression, latest.paint_line["line-color"], id, { line_class: lineClass }));

/** Every operator in an expression, however deeply nested. */
function operators(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const own = typeof value[0] === "string" ? [value[0]] : [];
  return [...own, ...value.flatMap(operators)];
}

describe("indexing the rides", () => {
  test("whole, partial and closed, each sorted", () => {
    const rides = indexRides([ride(9, true), ride(3, false, true), ride(5, true, true)]);
    assert.deepEqual(rides.whole, [5, 9]);
    assert.deepEqual(rides.partial, [3]);
    assert.deepEqual(rides.closed, [3, 5]);
    assert.deepEqual(rides.ridden, [3, 5, 9]);
    assert.equal(rides.byId.get(3)?.journey_name, "Trip");
  });

  test("a route listed twice keeps its last entry, in one list only", () => {
    const rides = indexRides([ride(4, false), ride(4, true)]);
    assert.deepEqual(rides.whole, [4]);
    assert.deepEqual(rides.partial, []);
  });

  test("before the local statuses load: every logged route kept, none coloured", () => {
    const rides = provisionalRides([7, 2, 7]);
    assert.deepEqual(rides.closed, [2, 7]);
    assert.deepEqual([rides.ridden, rides.whole, rides.partial, rides.byId.size], [[], [], [], 0]);
  });

  test("a failed refresh keeps the earlier rides and lets the logged routes through", () => {
    const earlier = indexRides([ride(3, true, true)]);
    const kept = keepWithProvisional(earlier, provisionalRides([3, 8]));
    assert.deepEqual(kept.closed, [3, 8]);
    assert.deepEqual(kept.whole, [3]);
    // Nothing new logged: the same object, so nothing is restyled
    assert.equal(keepWithProvisional(earlier, provisionalRides([3])), earlier);
    const provisional = provisionalRides([2]);
    assert.equal(keepWithProvisional(null, provisional), provisional);
  });

  test("an answer that changed nothing is the same rides", () => {
    const rides = () => indexRides([ride(1, true), ride(2, false)]);
    assert.equal(sameRides(rides(), rides()), true);
    assert.equal(sameRides(rides(), indexRides([ride(1, true), ride(2, true)])), false);
    assert.equal(
      sameRides(rides(), indexRides([ride(1, true), { ...ride(2, false), date: "2025-01-01" }])),
      false,
    );
    assert.equal(sameRides(rides(), null), false);
    assert.equal(sameRides(null, null), true);
  });

  test("a failed read is retried less and less often, never given up", () => {
    const delays = [0, 1, 2, 3, 10].map(ridesRetryDelayMs);
    assert.deepEqual(
      delays,
      [...delays].sort((a, b) => a - b),
    );
    assert.equal(ridesRetryDelayMs(100), 300_000);
  });
});

describe("the route colour", () => {
  const colors = routeColors("light");

  test("whole, partial and unridden, by feature id", () => {
    const expression = getUserRouteColorExpression(
      "light",
      indexRides([ride(1, true), ride(2, false)]),
    );
    assert.equal(colorOf(expression, 1), colors.visited.main);
    assert.equal(colorOf(expression, 2), colors.partial.main);
    assert.equal(colorOf(expression, 3), colors.unvisited.main);
  });

  test("still by line class within a status", () => {
    const expression = getUserRouteColorExpression("light", indexRides([ride(1, true)]));
    assert.equal(colorOf(expression, 1, "highspeed"), colors.visited.highspeed);
    assert.equal(colorOf(expression, 1, "branch"), colors.visited.branch);
  });

  test("an empty status leaves no empty match branch", () => {
    const partialOnly = getUserRouteColorExpression("light", indexRides([ride(2, false)]));
    assert.equal(colorOf(partialOnly, 2), colors.partial.main);
    const none = getUserRouteColorExpression("light", NO_RIDES);
    assert.equal(colorOf(none, 2), colors.unvisited.main);
  });

  test("follows the scheme", () => {
    const dark = getUserRouteColorExpression("dark", indexRides([ride(1, true)]));
    assert.equal(colorOf(dark, 1), routeColors("dark").visited.main);
  });

  test("never an `all`, which MapLibre Native can't take in a paint case", () => {
    const expression = getUserRouteColorExpression(
      "light",
      indexRides([ride(1, true), ride(2, false)]),
    );
    assert.equal(operators(expression).includes("all"), false);
  });
});

describe("the draw order", () => {
  const sortKey = latest.layout_line["line-sort-key"];

  test("ridden lines over unridden ones", () => {
    const expression = getUserRouteSortKeyExpression(indexRides([ride(1, true), ride(2, false)]));
    assert.equal(evaluate(expression, sortKey, 1), 1);
    assert.equal(evaluate(expression, sortKey, 2), 1);
    assert.equal(evaluate(expression, sortKey, 3), 0);
  });

  test("a constant with nothing ridden", () => {
    assert.equal(getUserRouteSortKeyExpression(NO_RIDES), 0);
  });
});

describe("the user map's layers", () => {
  const passes = (filter: FilterSpecification | undefined, id: number, closed: boolean) =>
    filter === undefined ||
    featureFilter(filter, "layers[0].filter").filter({ zoom: 8 }, {
      type: 2,
      id,
      properties: { usage_type: 0, closed },
      geometry: [],
    } as never);

  test("a closed route the owner rode stays on the map, one they didn't goes", () => {
    const rides = indexRides([ride(5, false, true)]);
    const layer = createUserMapLayers("light", undefined, rides).find(
      (candidate) => candidate.id === REGULAR_ROUTE_LAYER_ID,
    );
    assert.ok(layer && "filter" in layer);
    assert.equal(passes(layer.filter, 5, true), true);
    assert.equal(passes(layer.filter, 6, true), false);
    assert.equal(passes(layer.filter, 6, false), true);
  });

  test("the three route lines share one colour and draw order", () => {
    const { route, heritage, special } = userRouteLayerConfigs(
      "light",
      undefined,
      indexRides([ride(1, true)]),
    );
    assert.deepEqual(heritage.colorExpression, route.colorExpression);
    assert.deepEqual(special.sortKeyExpression, route.sortKeyExpression);
  });

  test("with no rides known, the routes start hidden", () => {
    const visibility = (rides: Parameters<typeof createUserMapLayers>[2]) =>
      createUserMapLayers("light", undefined, rides)
        .filter((layer) => layer.id === REGULAR_ROUTE_LAYER_ID || layer.id === ROUTE_CLICK_LAYER_ID)
        .map((layer) => layer.layout?.visibility);
    assert.deepEqual(visibility(null), ["none", "none"]);
    assert.deepEqual(visibility(NO_RIDES), ["visible", "visible"]);
  });
});
