"use server";

/**
 * The web app's entry point to the journey planner.
 *
 * The search itself is in `routePathFinder.ts`, a plain module, so the mobile
 * API's route handler can call it too (MOBILE_APP_PLAN.md, Phase 1). It needs
 * no session: route data is public, and the planner writes nothing.
 */

import { findRoutePathBetweenStations as findPath, type PathResult } from "./routePathFinder";

export async function findRoutePathBetweenStations(
  fromStationId: number,
  toStationId: number,
  viaStationIds: number[] = [],
): Promise<PathResult> {
  return findPath(fromStationId, toStationId, viaStationIds);
}
