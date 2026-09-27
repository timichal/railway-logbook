import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { coordinateToKey } from "@/lib/coordinateUtils";
import {
  buildCoordinatesWithTruncation,
  coordinateDistance,
  findBacktracking,
  isTraversedForward,
  junctionAngle,
  pathDistance,
  wouldCreateBacktracking,
} from "@/scripts/lib/partGeometry";
import type { RailwayPart } from "@/scripts/lib/partNetwork";

type Coord = [number, number];

function part(id: string, ...coordinates: Coord[]): RailwayPart {
  const startPoint = coordinates[0];
  const endPoint = coordinates[coordinates.length - 1];
  return {
    id,
    coordinates,
    startPoint,
    endPoint,
    startKey: coordinateToKey(startPoint),
    endKey: coordinateToKey(endPoint),
    lengthMeters: coordinateDistance(coordinates),
  };
}

/** Coordinates equal to within ~1mm, the precision a projected click lands at. */
function assertCoordsClose(actual: Coord[], expected: Coord[]) {
  assert.equal(actual.length, expected.length, `${JSON.stringify(actual)}`);
  actual.forEach((coord, i) => {
    const close =
      Math.abs(coord[0] - expected[i][0]) < 1e-8 && Math.abs(coord[1] - expected[i][1]) < 1e-8;
    assert.ok(close, `point ${i}: ${JSON.stringify(coord)} != ${JSON.stringify(expected[i])}`);
  });
}

// Along latitude 50, 0.01° of longitude (~715m) apart
const A: Coord = [14.0, 50.0];
const B: Coord = [14.01, 50.0];
const C: Coord = [14.02, 50.0];
const D: Coord = [14.03, 50.0];

describe("isTraversedForward", () => {
  const ab = part("ab", A, B);
  const bc = part("bc", B, C);
  const cb = part("cb", C, B);

  test("is decided by the next part when there is one", () => {
    assert.equal(isTraversedForward(ab, null, bc), true);
    assert.equal(isTraversedForward(cb, null, ab), true);
    assert.equal(isTraversedForward(bc, null, ab), false);
  });

  test("falls back to the previous part", () => {
    assert.equal(isTraversedForward(bc, ab, null), true);
    assert.equal(isTraversedForward(cb, ab, null), false);
  });

  test("defaults to forward", () => {
    assert.equal(isTraversedForward(ab, null, null), true);
  });
});

describe("junctionAngle", () => {
  test("straight on is 0°, and the vertex is the connection", () => {
    const junction = junctionAngle(null, part("ab", A, B), part("cb", C, B), null);
    assert.ok(junction);
    assert.ok(junction.angleDegrees < 1e-6);
    assert.deepEqual(junction.vertex, B);
  });

  test("a right-angle turn is about 90°", () => {
    const north: Coord = [14.01, 50.01];
    const junction = junctionAngle(null, part("ab", A, B), part("bn", B, north), null);
    assert.ok(junction);
    assert.ok(Math.abs(junction.angleDegrees - 90) < 1);
  });

  test("a part too short to have a bearing has no angle", () => {
    assert.equal(junctionAngle(null, part("b", B), part("bc", B, C), null), null);
  });
});

describe("findBacktracking", () => {
  test("a straight path does not backtrack", () => {
    assert.equal(findBacktracking([part("ab", A, B), part("bc", B, C), part("dc", D, C)]), null);
  });

  test("a V turn is found, at its vertex", () => {
    const back: Coord = [14.0, 50.001];
    const found = findBacktracking([part("ab", A, B), part("bc", B, C), part("cx", C, back)]);
    assert.ok(found);
    assert.equal(found.fromPartId, "bc");
    assert.equal(found.toPartId, "cx");
    assert.deepEqual(found.coordinate, C);
    assert.ok(found.angleDegrees > 170);
  });

  test("a sharp turn short of the threshold is not backtracking", () => {
    // ~135° turn: back and well off to one side
    const aside: Coord = [14.01 - 0.01, 50.0 + 0.01 * Math.cos((50 * Math.PI) / 180)];
    assert.equal(findBacktracking([part("ab", A, B), part("bx", B, aside)]), null);
  });
});

describe("wouldCreateBacktracking", () => {
  const ab = part("ab", A, B);
  const bc = part("bc", B, C);

  test("carrying straight on is fine", () => {
    assert.equal(wouldCreateBacktracking(ab, bc, part("cd", C, D)), false);
  });

  test("a part entered and left through the same node is a reversal", () => {
    // bc is entered at B from ab, and the next part leaves from B too
    const spur = part("bs", B, [14.01, 50.01]);
    assert.equal(wouldCreateBacktracking(ab, bc, spur), true);
  });

  test("a V at the new connection", () => {
    assert.equal(wouldCreateBacktracking(ab, bc, part("cx", C, [14.0, 50.001])), true);
  });

  test("with no previous part only the angle counts", () => {
    assert.equal(wouldCreateBacktracking(null, ab, bc), false);
  });
});

describe("pathDistance", () => {
  test("sums every segment of every part", () => {
    const parts = [part("ab", A, B), part("bd", B, C, D)];
    assert.equal(pathDistance(parts), coordinateDistance([A, B, C, D]));
    assert.ok(Math.abs(pathDistance(parts) - 2145) < 5);
  });
});

describe("buildCoordinatesWithTruncation", () => {
  const onAB: Coord = [14.005, 50.0];
  const onCD: Coord = [14.025, 50.0];

  test("nothing in, nothing out", () => {
    assert.deepEqual(buildCoordinatesWithTruncation([], A, B), []);
  });

  test("a single part is cut between the two clicks", () => {
    const abcd = part("abcd", A, B, C, D);
    assertCoordsClose(buildCoordinatesWithTruncation([abcd], onAB, onCD), [onAB, B, C, onCD]);
  });

  test("a single part clicked end first runs from the start click", () => {
    const abcd = part("abcd", A, B, C, D);
    assertCoordsClose(buildCoordinatesWithTruncation([abcd], onCD, onAB), [onCD, C, B, onAB]);
  });

  test("both clicks on one segment", () => {
    const ab = part("ab", A, B);
    const later: Coord = [14.008, 50.0];
    assertCoordsClose(buildCoordinatesWithTruncation([ab], onAB, later), [onAB, later]);
  });

  test("the edge parts are cut at the clicks, the middle ones kept whole", () => {
    const parts = [part("ab", A, B), part("bc", B, C), part("cd", C, D)];
    assertCoordsClose(buildCoordinatesWithTruncation(parts, onAB, onCD), [onAB, B, C, onCD]);
  });

  test("parts stored against the direction of travel", () => {
    const parts = [part("ba", B, A), part("cb", C, B), part("dc", D, C)];
    assertCoordsClose(buildCoordinatesWithTruncation(parts, onAB, onCD), [onAB, B, C, onCD]);
  });

  test("a click projected off the line lands on it", () => {
    const parts = [part("ab", A, B), part("bc", B, C)];
    const offAB: Coord = [14.005, 50.0001];
    assertCoordsClose(buildCoordinatesWithTruncation(parts, offAB, C), [onAB, B, C]);
  });

  test("a start click exactly on the shared node does not reverse the route", () => {
    const parts = [part("ab", A, B), part("bc", B, C), part("cd", C, D)];
    assertCoordsClose(buildCoordinatesWithTruncation(parts, B, onCD), [B, C, onCD]);

    const reversed = [part("ba", B, A), part("cb", C, B), part("dc", D, C)];
    assertCoordsClose(buildCoordinatesWithTruncation(reversed, B, onCD), [B, C, onCD]);
  });

  test("an end click exactly on the shared node", () => {
    const parts = [part("ab", A, B), part("bc", B, C), part("cd", C, D)];
    assertCoordsClose(buildCoordinatesWithTruncation(parts, onAB, C), [onAB, B, C]);
  });

  test("parts that do not join end to end are a broken chain", () => {
    const parts = [part("ab", A, B), part("cd", C, D)];
    assert.throws(() => buildCoordinatesWithTruncation(parts, onAB, onCD), /Chain is broken/);
  });
});
