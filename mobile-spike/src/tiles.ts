/**
 * Where the vector tiles come from.
 *
 * The web app derives this from `window.location` (`getTileBaseUrl()` in
 * `src/lib/map/index.ts`). There is no `window` in React Native, so the plan's
 * prediction holds: it becomes a build-time constant. The spike hardcodes
 * production, which is also the point — both platforms block cleartext HTTP by
 * default (iOS App Transport Security, Android since 9), so this is the first
 * thing the spike proves works.
 */
export const TILE_BASE_URL = "https://railmap.zlatkovsky.cz/tiles";

/** Zoom ranges, copied from ZOOM_RANGES in `src/lib/map/index.ts`. */
export const ZOOM_RANGES = {
  railwayRoutes: { min: 4, max: 18 },
  stations: { min: 9, max: 18 },
} as const;

/**
 * The route tile URL template, built exactly as `createRailwayRoutesSource`
 * builds it on the web.
 *
 * `userId` is what makes the tile expensive: it turns on the per-user LATERAL
 * join for the most recent journey plus `user_fully_ridden_routes`, which is the
 * heaviest part of the query and the reason the route colours mean anything. The
 * spike toggles it so the cost is attributable.
 */
export function railwayRoutesTileUrl(userId?: number): string {
  const base = `${TILE_BASE_URL}/railway_routes_tile/{z}/{x}/{y}`;
  return userId === undefined ? base : `${base}?user_id=${userId}`;
}

export function publicStationsTileUrl(): string {
  return `${TILE_BASE_URL}/public_stations_tile/{z}/{x}/{y}`;
}
