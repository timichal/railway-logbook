import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type Coord, coordinatesToWKT, mergeLinearChain } from "@/lib/coordinateUtils";

const A: Coord = [14.0, 50.0];
const B: Coord = [14.01, 50.0];
const C: Coord = [14.02, 50.0];
const D: Coord = [14.03, 50.0];
const MID: Coord = [14.005, 50.001];

describe("mergeLinearChain", () => {
  test("nothing, and a single sublist as it is", () => {
    assert.deepEqual(mergeLinearChain([]), []);
    assert.deepEqual(mergeLinearChain([[], []]), []);
    assert.deepEqual(mergeLinearChain([[A, MID, B]]), [A, MID, B]);
  });

  test("joins sublists already running in path order", () => {
    assert.deepEqual(
      mergeLinearChain([
        [A, MID, B],
        [B, C],
        [C, D],
      ]),
      [A, MID, B, C, D],
    );
  });

  test("turns round a sublist stored the other way", () => {
    assert.deepEqual(
      mergeLinearChain([
        [A, B],
        [C, B],
        [C, D],
      ]),
      [A, B, C, D],
    );
  });

  test("turns round a first sublist facing away from the second", () => {
    assert.deepEqual(
      mergeLinearChain([
        [B, MID, A],
        [B, C],
      ]),
      [A, MID, B, C],
    );
  });

  test("a start click on a shared node does not reverse the chain", () => {
    // The first part truncated to a point: no endpoint is unique at the start
    assert.deepEqual(
      mergeLinearChain([
        [B, B],
        [B, C],
        [C, D],
      ]),
      [B, C, D],
    );
    // Same, with the parts stored against the direction of travel
    assert.deepEqual(
      mergeLinearChain([
        [B, B],
        [C, B],
        [D, C],
      ]),
      [B, C, D],
    );
    assert.deepEqual(mergeLinearChain([[B], [C, B]]), [B, C]);
  });

  test("an end click on a shared node adds nothing", () => {
    assert.deepEqual(
      mergeLinearChain([
        [A, B],
        [B, C],
        [C, C],
      ]),
      [A, B, C],
    );
  });

  test("every part zero-length still makes a two-point line", () => {
    assert.deepEqual(
      mergeLinearChain([
        [B, B],
        [B, B],
      ]),
      [B, B],
    );
  });

  test("matches endpoints despite floating-point noise", () => {
    const nearlyB: Coord = [14.01 + 1e-10, 50.0 - 1e-10];
    assert.deepEqual(
      mergeLinearChain([
        [A, B],
        [nearlyB, C],
      ]),
      [A, B, C],
    );
  });

  test("a sublist meeting the tail only mid-way is a broken chain", () => {
    const crossing: Coord[] = [[14.01, 49.99], B, [14.01, 50.01]];
    assert.throws(() => mergeLinearChain([[A, B], crossing]), /Chain is broken/);
  });

  test("a first sublist that meets nothing is a broken chain", () => {
    assert.throws(
      () =>
        mergeLinearChain([
          [A, B],
          [C, D],
        ]),
      /Chain is broken/,
    );
  });
});

describe("coordinatesToWKT", () => {
  test("writes lon lat pairs", () => {
    assert.equal(coordinatesToWKT([A, B]), "LINESTRING(14 50,14.01 50)");
  });
});
