/**
 * Calculate bearing from coord1 to coord2 in degrees (0-360)
 * Coordinates are [longitude, latitude]
 */
export function calculateBearing(
  coord1: [number, number],
  coord2: [number, number]
): number {
  const lon1 = coord1[0] * Math.PI / 180;
  const lon2 = coord2[0] * Math.PI / 180;
  const lat1 = coord1[1] * Math.PI / 180;
  const lat2 = coord2[1] * Math.PI / 180;

  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  const bearing = Math.atan2(y, x) * 180 / Math.PI;

  return (bearing + 360) % 360;
}
