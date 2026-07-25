/**
 * Calculate bearing from coord1 to coord2 in degrees (0-360)
 * Coordinates are [longitude, latitude]
 */
export function calculateBearing(coord1: [number, number], coord2: [number, number]): number {
  const lon1 = (coord1[0] * Math.PI) / 180;
  const lon2 = (coord2[0] * Math.PI) / 180;
  const lat1 = (coord1[1] * Math.PI) / 180;
  const lat2 = (coord2[1] * Math.PI) / 180;

  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;

  return (bearing + 360) % 360;
}

/**
 * Great-circle distance between two [longitude, latitude] points, in meters.
 * Haversine formula.
 */
export function haversineDistance(coord1: [number, number], coord2: [number, number]): number {
  const R = 6371000; // Earth's radius in meters
  const lat1 = (coord1[1] * Math.PI) / 180;
  const lat2 = (coord2[1] * Math.PI) / 180;
  const deltaLat = ((coord2[1] - coord1[1]) * Math.PI) / 180;
  const deltaLon = ((coord2[0] - coord1[0]) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Bearing difference above which a connection between two segments is treated
 * as backtracking (a tight "V" turn). Shared by the admin recalc pathfinder
 * and the user-facing journey planner.
 */
export const BACKTRACKING_THRESHOLD_DEGREES = 140;

/**
 * Absolute difference between two bearings (degrees), normalized to [0, 180].
 */
export function normalizeBearingDifference(bearingA: number, bearingB: number): number {
  const diff = Math.abs(bearingA - bearingB);
  return diff > 180 ? 360 - diff : diff;
}
