import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { PartNetwork } from "@/scripts/lib/partNetwork";
import { RailwayPathFinder } from "@/scripts/lib/railwayPathFinder";

type Coord = [number, number];

/** A finder over the given parts, loaded as `findPathFromCoordinates` would load them. */
function finderOver(parts: Record<string, Coord[]>): RailwayPathFinder {
  const finder = new RailwayPathFinder({ quiet: true });
  (finder as unknown as { network: PartNetwork }).network.add(
    Object.entries(parts).map(([id, coordinates]) => ({ id, coordinates })),
  );
  return finder;
}

// A line east from 1 to 9, with two ways round between (0.01, 0) and (0.03, 0)
const start: Coord[] = [
  [0, 0],
  [0.01, 0],
];
const end: Coord[] = [
  [0.03, 0],
  [0.04, 0],
];
const loopOut: Coord[] = [
  [0.01, 0],
  [0.015, 0.01],
  [0.02, 0.012],
];
const loopBack: Coord[] = [
  [0.02, 0.012],
  [0.025, 0.01],
  [0.03, 0],
];
const straightOut: Coord[] = [
  [0.01, 0],
  [0.02, 0],
];
const straightBack: Coord[] = [
  [0.02, 0],
  [0.03, 0],
];

describe("RailwayPathFinder.findPath", () => {
  test("takes the shorter of two ways round, whatever their ids", () => {
    // The loop has the lower ids, so a search that settles ties by id takes it
    const finder = finderOver({
      1: start,
      10: loopOut,
      11: loopBack,
      20: straightOut,
      21: straightBack,
      9: end,
    });
    assert.deepEqual(finder.findPath("1", "9")[0]?.partIds, ["1", "20", "21", "9"]);
  });

  test("the same with the ids the other way round", () => {
    const finder = finderOver({
      1: start,
      10: straightOut,
      11: straightBack,
      20: loopOut,
      21: loopBack,
      9: end,
    });
    assert.deepEqual(finder.findPath("1", "9")[0]?.partIds, ["1", "10", "11", "9"]);
  });

  test("a shorter way of more parts wins over a long one of fewer", () => {
    const finder = finderOver({
      1: start,
      10: [...loopOut, ...loopBack.slice(1)],
      20: straightOut,
      21: straightBack,
      9: end,
    });
    assert.deepEqual(finder.findPath("1", "9")[0]?.partIds, ["1", "20", "21", "9"]);
  });
});

// A reversal shortcut: from 1, heading east into B, part 30 turns straight back
// north-west to P, where 9 carries on west. The way round without the reversal
// carries on east to C and loops back over the top to P.
const B: Coord = [0.01, 0];
const P: Coord = [0.005, 0.002];
const reversal = {
  1: start,
  30: [B, P],
  9: [P, [-0.005, 0.002]] as Coord[],
};
const wayRound = {
  40: [B, [0.02, 0]] as Coord[],
  41: [[0.02, 0], [0.025, 0.002], [0.02, 0.004], [0.01, 0.004], P] as Coord[],
};

describe("RailwayPathFinder.findPath with a reversal", () => {
  test("takes the way round, however much longer, with the reversal to fall back on", () => {
    const [preferred, fallback] = finderOver({ ...reversal, ...wayRound }).findPath("1", "9");
    assert.deepEqual(preferred.partIds, ["1", "40", "41", "9"]);
    assert.equal(preferred.hasBacktracking, false);
    assert.deepEqual(fallback.partIds, ["1", "30", "9"]);
    assert.equal(fallback.hasBacktracking, true);
  });

  test("keeps the reversal when nothing else connects", () => {
    const candidates = finderOver(reversal).findPath("1", "9");
    assert.equal(candidates.length, 1);
    assert.deepEqual(candidates[0].partIds, ["1", "30", "9"]);
    assert.equal(candidates[0].hasBacktracking, true);
  });
});

describe("RailwayPathFinder.findPath from click points", () => {
  // Start part 1 runs from W to E with its click 11m from E. From W a straight
  // part 20 reaches Q; from E a longer, bent part 30 does. Whole, 1 costs the
  // same both ways and 20 wins; travelled from the click, 30 is the shorter.
  const W: Coord = [0, 0];
  const E: Coord = [0.01, 0];
  const Q: Coord = [0.005, 0.01];
  const finder = finderOver({
    1: [W, E],
    20: [W, Q],
    30: [E, [0.012, 0.005], Q],
    9: [Q, [0.005, 0.02]],
  });

  test("charges the start part only for the stretch left from the click", () => {
    const clicks = { start: [0.0099, 0] as Coord, end: [0.005, 0.015] as Coord };
    assert.deepEqual(finder.findPath("1", "9", clicks)[0]?.partIds, ["1", "30", "9"]);
  });

  test("and from the other end of it, the other way", () => {
    const clicks = { start: [0.0001, 0] as Coord, end: [0.005, 0.015] as Coord };
    assert.deepEqual(finder.findPath("1", "9", clicks)[0]?.partIds, ["1", "20", "9"]);
  });
});
