"use server";

/**
 * The web app's entry point to the journey planner.
 *
 * The search itself is in `routePathFinder.ts`, a plain module, so the mobile
 * API's route handler can call it too (MOBILE_APP_PLAN.md, Phase 1). It needs
 * no session: route data is public, and the planner writes nothing.
 */

import { findRoutePathBetweenStations as findPath, type PathResult } from "./routePathFinder";
import { routeBoundsByIds } from "./routeQueries";
import type { RouteBounds } from "./shared/types";

/**
 * A plan, with the bounds the map fits to when it is shown: the whole routes' box,
 * widened by the stretch actually travelled on each partly covered one, so a plan
 * joining a 300km trunk mid-way fits to the part ridden. Not region-scoped — every
 * route of a plan is reached from its stations, so it never leaves their region.
 */
export async function findRoutePathBetweenStations(
  fromStationId: number,
  toStationId: number,
  viaStationIds: number[] = [],
): Promise<PathResult & { bounds: RouteBounds | null }> {
  const result = await findPath(fromStationId, toStationId, viaStationIds);
  if (result.error) return { ...result, bounds: null };

  const whole = result.routes.filter((r) => !r.partial).map((r) => r.track_id);
  let bounds = await routeBoundsByIds(whole, null);
  for (const route of result.routes) {
    for (const [lng, lat] of route.partial?.coordinates ?? []) {
      bounds = bounds
        ? [
            Math.min(bounds[0], lng),
            Math.min(bounds[1], lat),
            Math.max(bounds[2], lng),
            Math.max(bounds[3], lat),
          ]
        : [lng, lat, lng, lat];
    }
  }
  return { ...result, bounds };
}
