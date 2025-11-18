/**
 * Geometry utilities for railway part splitting
 * Handles finding split points and dividing LineStrings into segments
 */

import { calculateDistance } from '@/lib/map/utils/distance';

/**
 * Calculate perpendicular distance from a point to a line segment
 * Returns the closest point on the segment and the distance
 */
function pointToSegmentDistance(
  point: [number, number],
  segmentStart: [number, number],
  segmentEnd: [number, number]
): { distance: number; closestPoint: [number, number] } {
  const [px, py] = point;
  const [x1, y1] = segmentStart;
  const [x2, y2] = segmentEnd;

  // Calculate the parameter t for the projection of point onto the line
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;

  // If segment is actually a point, return distance to that point
  if (lengthSquared === 0) {
    return {
      distance: calculateDistance(point, segmentStart),
      closestPoint: segmentStart,
    };
  }

  // Calculate projection parameter (clamped to [0, 1] to stay on segment)
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  // Calculate closest point on segment
  const closestPoint: [number, number] = [x1 + t * dx, y1 + t * dy];

  // Calculate distance using Haversine
  const distance = calculateDistance(point, closestPoint);

  return { distance, closestPoint };
}

/**
 * Find the nearest segment in a LineString to a clicked point
 * Returns the segment index and the exact split point on that segment
 */
export function findNearestSegment(
  coordinates: [number, number][],
  clickPoint: [number, number]
): { segmentIndex: number; splitPoint: [number, number] } | null {
  if (coordinates.length < 2) {
    return null;
  }

  let nearestSegmentIndex = 0;
  let nearestDistance = Infinity;
  let nearestSplitPoint: [number, number] = coordinates[0];

  // Check each segment of the LineString
  for (let i = 0; i < coordinates.length - 1; i++) {
    const result = pointToSegmentDistance(clickPoint, coordinates[i], coordinates[i + 1]);

    if (result.distance < nearestDistance) {
      nearestDistance = result.distance;
      nearestSegmentIndex = i;
      nearestSplitPoint = result.closestPoint;
    }
  }

  return {
    segmentIndex: nearestSegmentIndex,
    splitPoint: nearestSplitPoint,
  };
}

/**
 * Split a LineString at a specific point on a specific segment
 * Returns two coordinate arrays representing the two split parts
 */
export function splitLineStringAtPoint(
  coordinates: [number, number][],
  segmentIndex: number,
  splitPoint: [number, number]
): { segment1: [number, number][]; segment2: [number, number][] } {
  if (segmentIndex < 0 || segmentIndex >= coordinates.length - 1) {
    throw new Error('Invalid segment index for splitting');
  }

  // First segment: from start to split point (inclusive)
  const segment1 = [
    ...coordinates.slice(0, segmentIndex + 1),
    splitPoint,
  ];

  // Second segment: from split point to end (inclusive)
  const segment2 = [
    splitPoint,
    ...coordinates.slice(segmentIndex + 1),
  ];

  return { segment1, segment2 };
}

/**
 * Validate that a split point is reasonable (not too close to existing vertices)
 * Returns true if the split point is at least minDistance km from both endpoints
 */
export function isValidSplitPoint(
  splitPoint: [number, number],
  segmentStart: [number, number],
  segmentEnd: [number, number],
  minDistanceKm: number = 0.01 // 10 meters minimum
): boolean {
  const distanceToStart = calculateDistance(splitPoint, segmentStart);
  const distanceToEnd = calculateDistance(splitPoint, segmentEnd);
  return distanceToStart >= minDistanceKm && distanceToEnd >= minDistanceKm;
}
