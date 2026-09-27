/**
 * Geometry over railway parts, for the recalculation pathfinder: which way a
 * part is travelled, where a path doubles back, and how a route's coordinates
 * are cut out of its parts at the click points. Pure — every function takes the
 * parts themselves, so none needs a loaded `PartNetwork`.
 */

import { mergeLinearChain } from "../../lib/coordinateUtils";
import {
  BACKTRACKING_THRESHOLD_DEGREES,
  calculateBearing,
  haversineDistance,
  normalizeBearingDifference,
} from "../../lib/geoUtils";
import type { BacktrackingPoint } from "../../lib/shared/types";
import type { RailwayPart } from "./partNetwork";

interface PointOnSegment {
  projectedPoint: [number, number];
  distance: number;
}

interface NearestPointResult extends PointOnSegment {
  segmentIndex: number;
}

// ============================================================================
// ORIENTATION
// ============================================================================

/** Whether `part`'s last coordinate is one of `other`'s endpoints. */
function endTouches(part: RailwayPart, other: RailwayPart): boolean {
  return part.endKey === other.startKey || part.endKey === other.endKey;
}

/** Whether `part`'s first coordinate is one of `other`'s endpoints. */
function startTouches(part: RailwayPart, other: RailwayPart): boolean {
  return part.startKey === other.startKey || part.startKey === other.endKey;
}

/**
 * Determine if a part should be traversed forward (first→last) or backward (last→first)
 */
export function isTraversedForward(
  part: RailwayPart,
  prev: RailwayPart | null,
  next: RailwayPart | null,
): boolean {
  // Determine orientation based on next part: if end connects to next, we're going forward
  if (next) return endTouches(part, next);

  // Determine orientation based on previous part: if start connects to prev, we're going forward
  if (prev) return startTouches(part, prev);

  return true; // Default: forward
}

/**
 * Get the segment coordinates near a connection point for bearing calculation
 *
 * @param isExit - If true, returns segment near where we EXIT. If false, returns entry segment.
 */
function connectionSegment(
  part: RailwayPart,
  prev: RailwayPart | null,
  next: RailwayPart | null,
  isExit: boolean,
): [[number, number], [number, number]] | null {
  if (part.coordinates.length < 2) return null;

  const coords = part.coordinates;
  const isForward = isTraversedForward(part, prev, next);

  if (isExit) {
    // Segment near where we EXIT this part
    if (isForward) {
      return [coords[coords.length - 2], coords[coords.length - 1]];
    } else {
      return [coords[1], coords[0]];
    }
  } else {
    // Segment near where we ENTER this part
    if (isForward) {
      return [coords[0], coords[1]];
    } else {
      return [coords[coords.length - 1], coords[coords.length - 2]];
    }
  }
}

// ============================================================================
// BACKTRACKING DETECTION
// ============================================================================

/**
 * The turn at the connection from `current` to `next`, in degrees (0 = straight
 * on, 180 = straight back), and the connection's coordinate — the vertex of the
 * V when it doubles back.
 *
 * Each part's direction of travel is settled by its neighbours along the path,
 * so `prev` orients `current` when nothing else can and `afterNext` orients
 * `next`; either is null where the path has no such part, or where the caller
 * does not know it yet (a search still growing the path).
 */
export function junctionAngle(
  prev: RailwayPart | null,
  current: RailwayPart,
  next: RailwayPart,
  afterNext: RailwayPart | null,
): { angleDegrees: number; vertex: [number, number] } | null {
  const exitSegment = connectionSegment(current, prev, next, true);
  const entrySegment = connectionSegment(next, current, afterNext, false);
  if (!exitSegment || !entrySegment) return null;

  return {
    angleDegrees: normalizeBearingDifference(
      calculateBearing(exitSegment[0], exitSegment[1]),
      calculateBearing(entrySegment[0], entrySegment[1]),
    ),
    // The exit segment ends at the connection, which is the V's vertex
    vertex: exitSegment[1],
  };
}

/**
 * Check if appending `next` to a path ending in `prev`, `current` would create
 * backtracking.
 *
 * `current` was checked when it was added, oriented from `prev` — the only
 * neighbour it had then. Now that the part after it is known, its orientation is
 * settled by that one instead (as `findBacktracking` will judge it), and the two
 * must agree: a part entered and left through the same node is a reversal,
 * whatever the angle to the next part says. Let through, it reached the parts
 * beyond at a distance no train can travel and pruned the clean path to them,
 * only for the final check to reject it.
 */
export function wouldCreateBacktracking(
  prev: RailwayPart | null,
  current: RailwayPart,
  next: RailwayPart,
): boolean {
  if (prev && isTraversedForward(current, prev, null) !== isTraversedForward(current, null, next)) {
    return true;
  }

  const junction = junctionAngle(prev, current, next, null);
  return junction !== null && junction.angleDegrees > BACKTRACKING_THRESHOLD_DEGREES;
}

/**
 * Find where a path backtracks (tight "V" shapes), or null if it doesn't.
 * Uses segments near connection points for accurate bearing calculations.
 *
 * Returns the **first** such connection rather than a bare boolean: every
 * caller in the search only asks whether there is one, but the located answer is
 * what `npm run showBacktracking` needs to point an editor at the offending way,
 * and it is free to carry along the path result.
 */
export function findBacktracking(parts: RailwayPart[]): BacktrackingPoint | null {
  for (let i = 0; i < parts.length - 1; i++) {
    const junction = junctionAngle(
      i > 0 ? parts[i - 1] : null,
      parts[i],
      parts[i + 1],
      i + 2 < parts.length ? parts[i + 2] : null,
    );

    if (junction && junction.angleDegrees > BACKTRACKING_THRESHOLD_DEGREES) {
      return {
        fromPartId: parts[i].id,
        toPartId: parts[i + 1].id,
        angleDegrees: junction.angleDegrees,
        coordinate: junction.vertex,
      };
    }
  }

  return null;
}

// ============================================================================
// DISTANCES AND PROJECTION
// ============================================================================

/**
 * Project a point onto a line segment and return projection point + distance
 */
function projectPointOnSegment(
  point: [number, number],
  segmentStart: [number, number],
  segmentEnd: [number, number],
): PointOnSegment {
  const x = point[0];
  const y = point[1];
  const x1 = segmentStart[0];
  const y1 = segmentStart[1];
  const x2 = segmentEnd[0];
  const y2 = segmentEnd[1];

  const A = x - x1;
  const B = y - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx: number;
  let yy: number;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  return {
    projectedPoint: [xx, yy],
    distance: haversineDistance(point, [xx, yy]),
  };
}

/**
 * Calculate distance from point to line segment
 */
export function pointToSegmentDistance(
  point: [number, number],
  segmentStart: [number, number],
  segmentEnd: [number, number],
): number {
  return projectPointOnSegment(point, segmentStart, segmentEnd).distance;
}

/**
 * Find nearest point on a part to a coordinate
 * Returns segment index, projected point, and distance
 */
function findNearestPointOnPart(
  part: RailwayPart,
  coordinate: [number, number],
): NearestPointResult | null {
  let minDistance = Infinity;
  let bestSegmentIndex = -1;
  let bestProjectedPoint: [number, number] = [0, 0];

  for (let i = 0; i < part.coordinates.length - 1; i++) {
    const projection = projectPointOnSegment(
      coordinate,
      part.coordinates[i],
      part.coordinates[i + 1],
    );

    if (projection.distance < minDistance) {
      minDistance = projection.distance;
      bestSegmentIndex = i;
      bestProjectedPoint = projection.projectedPoint;
    }
  }

  if (bestSegmentIndex === -1) return null;

  return {
    segmentIndex: bestSegmentIndex,
    projectedPoint: bestProjectedPoint,
    distance: minDistance,
  };
}

/**
 * Calculate total distance for a path of parts
 *
 * Deliberately **not** a sum of the parts' `lengthMeters`: this is one running
 * sum over every segment of the path, and regrouping it per part rounds
 * differently in the last bits. Its result is compared against `maxDistance`
 * and between candidates, so a regrouped sum could, on a near tie, pick a
 * different path than before — and recalculation must return exactly what it
 * did. It runs once per completed path rather than per relaxation.
 */
export function pathDistance(parts: RailwayPart[]): number {
  let totalDistance = 0;

  for (const part of parts) {
    for (let i = 0; i < part.coordinates.length - 1; i++) {
      totalDistance += haversineDistance(part.coordinates[i], part.coordinates[i + 1]);
    }
  }

  return totalDistance;
}

/**
 * Calculate total distance for a coordinate chain
 */
export function coordinateDistance(coordinates: [number, number][]): number {
  let distance = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    distance += haversineDistance(coordinates[i], coordinates[i + 1]);
  }
  return distance;
}

// ============================================================================
// EDGE TRUNCATION
// ============================================================================

/**
 * Build coordinates with edge truncation for coordinate-based routes
 * Trims first and last parts from click points to their connections
 *
 * Throws "Chain is broken" (from `mergeLinearChain`) when the parts don't join
 * end to end.
 */
export function buildCoordinatesWithTruncation(
  parts: RailwayPart[],
  startCoordinate: [number, number],
  endCoordinate: [number, number],
): [number, number][] {
  if (parts.length === 0) return [];

  // Special case: single part
  if (parts.length === 1) {
    return buildSinglePartCoordinates(parts[0], startCoordinate, endCoordinate);
  }

  // Multi-part path: truncate first and last parts
  const coordinateSublists: [number, number][][] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (i === 0) {
      // First part: truncate from start coordinate to connection
      coordinateSublists.push(buildFirstPartCoordinates(part, parts[1], startCoordinate));
    } else if (i === parts.length - 1) {
      // Last part: truncate from connection to end coordinate
      coordinateSublists.push(buildLastPartCoordinates(part, parts[i - 1], endCoordinate));
    } else {
      // Middle part: use entire part
      coordinateSublists.push(part.coordinates);
    }
  }

  return mergeLinearChain(coordinateSublists);
}

/**
 * Build coordinates for a single-part route
 */
function buildSinglePartCoordinates(
  part: RailwayPart,
  startCoordinate: [number, number],
  endCoordinate: [number, number],
): [number, number][] {
  const startPoint = findNearestPointOnPart(part, startCoordinate);
  const endPoint = findNearestPointOnPart(part, endCoordinate);

  if (!startPoint || !endPoint) return part.coordinates;

  const coordinates: [number, number][] = [];

  if (startPoint.segmentIndex === endPoint.segmentIndex) {
    // Both on same segment
    coordinates.push(startPoint.projectedPoint);
    coordinates.push(endPoint.projectedPoint);
  } else if (startPoint.segmentIndex < endPoint.segmentIndex) {
    // Start before end
    coordinates.push(startPoint.projectedPoint);
    for (let i = startPoint.segmentIndex + 1; i <= endPoint.segmentIndex; i++) {
      coordinates.push(part.coordinates[i]);
    }
    coordinates.push(endPoint.projectedPoint);
  } else {
    // End before start - reverse
    coordinates.push(startPoint.projectedPoint);
    for (let i = startPoint.segmentIndex; i > endPoint.segmentIndex; i--) {
      coordinates.push(part.coordinates[i]);
    }
    coordinates.push(endPoint.projectedPoint);
  }

  return coordinates;
}

/**
 * Build coordinates for first part (truncated from start coordinate to connection)
 */
function buildFirstPartCoordinates(
  part: RailwayPart,
  nextPart: RailwayPart,
  startCoordinate: [number, number],
): [number, number][] {
  const startPoint = findNearestPointOnPart(part, startCoordinate);
  if (!startPoint) return part.coordinates;

  const truncated: [number, number][] = [];
  truncated.push(startPoint.projectedPoint);

  // Determine which endpoint connects to next part
  if (endTouches(part, nextPart)) {
    // Go from start point to end of part
    for (let j = startPoint.segmentIndex + 1; j < part.coordinates.length - 1; j++) {
      truncated.push(part.coordinates[j]);
    }
    // CRITICAL: Always end with exact endpoint for chain continuity
    truncated.push(part.endPoint);
  } else {
    // Go from start point to start of part (reverse)
    for (let j = startPoint.segmentIndex; j >= 1; j--) {
      truncated.push(part.coordinates[j]);
    }
    // CRITICAL: Always end with exact endpoint for chain continuity
    truncated.push(part.startPoint);
  }

  return truncated;
}

/**
 * Build coordinates for last part (truncated from connection to end coordinate)
 */
function buildLastPartCoordinates(
  part: RailwayPart,
  prevPart: RailwayPart,
  endCoordinate: [number, number],
): [number, number][] {
  const endPoint = findNearestPointOnPart(part, endCoordinate);
  if (!endPoint) return part.coordinates;

  const truncated: [number, number][] = [];

  // Determine which endpoint connects to previous part
  if (startTouches(part, prevPart)) {
    // Go from start of part to end point
    // CRITICAL: Always start with exact endpoint for chain continuity
    truncated.push(part.startPoint);
    for (let j = 1; j <= endPoint.segmentIndex; j++) {
      truncated.push(part.coordinates[j]);
    }
  } else {
    // Go from end of part to end point (reverse)
    // CRITICAL: Always start with exact endpoint for chain continuity
    truncated.push(part.endPoint);
    for (let j = part.coordinates.length - 2; j > endPoint.segmentIndex; j--) {
      truncated.push(part.coordinates[j]);
    }
  }

  truncated.push(endPoint.projectedPoint);
  return truncated;
}
