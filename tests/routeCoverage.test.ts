import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  coverageToleranceFraction,
  isRouteFullyRidden,
  MAX_TOLERANCE_FRACTION,
  type RiddenPart,
} from "@/lib/shared/routeCoverage";

const stretch = (covered_start: number, covered_end: number): RiddenPart => ({
  partial: true,
  covered_start,
  covered_end,
});

describe("coverageToleranceFraction", () => {
  test("is 0.3km as a fraction of the route", () => {
    assert.equal(coverageToleranceFraction(100), 0.003);
    assert.equal(coverageToleranceFraction(10), 0.03);
  });

  test("is capped on short routes", () => {
    assert.equal(coverageToleranceFraction(0.5), MAX_TOLERANCE_FRACTION);
  });

  test("is 0 when the length is unknown or not positive", () => {
    assert.equal(coverageToleranceFraction(null), 0);
    assert.equal(coverageToleranceFraction(undefined), 0);
    assert.equal(coverageToleranceFraction(0), 0);
    assert.equal(coverageToleranceFraction(-5), 0);
    assert.equal(coverageToleranceFraction(Number.NaN), 0);
  });
});

describe("isRouteFullyRidden", () => {
  test("nothing logged is not ridden", () => {
    assert.equal(isRouteFullyRidden([], 10), false);
  });

  test("one whole ride completes the route, whatever else is logged", () => {
    assert.equal(isRouteFullyRidden([stretch(0.4, 0.5), { partial: false }], 10), true);
  });

  test("two stretches meeting at one station add up to the whole", () => {
    assert.equal(isRouteFullyRidden([stretch(0.5, 1), stretch(0, 0.5)], 10), true);
  });

  test("a stretch from a station just inside the terminus still reaches the end", () => {
    // 10km route: tolerance 0.03 at each end
    assert.equal(isRouteFullyRidden([stretch(0.02, 0.99)], 10), true);
    assert.equal(isRouteFullyRidden([stretch(0.04, 1)], 10), false);
    assert.equal(isRouteFullyRidden([stretch(0, 0.96)], 10), false);
  });

  test("a gap of up to twice the tolerance between stretches is closed", () => {
    assert.equal(isRouteFullyRidden([stretch(0, 0.5), stretch(0.55, 1)], 10), true);
    assert.equal(isRouteFullyRidden([stretch(0, 0.5), stretch(0.61, 1)], 10), false);
  });

  test("overlapping and nested stretches are unioned in any order", () => {
    const parts = [stretch(0.6, 1), stretch(0.1, 0.2), stretch(0, 0.7), stretch(0.3, 0.4)];
    assert.equal(isRouteFullyRidden(parts, 10), true);
  });

  test("stretches of unknown extent contribute nothing", () => {
    const unknown: RiddenPart = { partial: true, covered_start: null, covered_end: null };
    assert.equal(isRouteFullyRidden([unknown], 10), false);
    assert.equal(isRouteFullyRidden([unknown, stretch(0, 0.5)], 10), false);
    assert.equal(isRouteFullyRidden([{ partial: true }, stretch(0, 0.5)], 10), false);
  });

  test("on a short route the stretch must still cover the middle half", () => {
    assert.equal(isRouteFullyRidden([stretch(0.25, 0.75)], 0.5), true);
    assert.equal(isRouteFullyRidden([stretch(0.26, 0.75)], 0.5), false);
  });

  test("with no known length there is no tolerance at all", () => {
    assert.equal(isRouteFullyRidden([stretch(0, 1)], null), true);
    assert.equal(isRouteFullyRidden([stretch(0.001, 1)], null), false);
  });
});
