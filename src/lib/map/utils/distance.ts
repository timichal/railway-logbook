/**
 * Calculate distance between two coordinates using Haversine formula
 */
export function calculateDistance(coord1: [number, number], coord2: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // Earth's radius in km

  const lat1 = toRad(coord1[1]);
  const lat2 = toRad(coord2[1]);
  const deltaLat = toRad(coord2[1] - coord1[1]);
  const deltaLon = toRad(coord2[0] - coord1[0]);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
