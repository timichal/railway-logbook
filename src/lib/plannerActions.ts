"use server";

/**
 * The web app's entry point to the journey planner.
 *
 * The search itself is in `routePathFinder.ts`, a plain module, so the mobile
 * API's route handler can call it too (MOBILE_APP_PLAN.md, Phase 1). It needs
 * no session: route data is public, and the planner writes nothing.
 */

import type { PlannerOptions } from "./planner/routeGraph";
import { type PathResult, planJourney } from "./routePathFinder";
import type { RouteBounds } from "./shared/types";

/** A plan, with the bounds the map fits to when it is shown (see planJourney). */
export async function findRoutePathBetweenStations(
  fromStationId: number,
  toStationId: number,
  viaStationIds: number[] = [],
  options: PlannerOptions = {},
): Promise<PathResult & { bounds: RouteBounds | null }> {
  return planJourney(fromStationId, toStationId, viaStationIds, options);
}
