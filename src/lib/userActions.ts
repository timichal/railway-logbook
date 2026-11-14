"use server";

/**
 * The route summaries for a visitor who isn't signed in, as a server action. The
 * other public reads are the `api/public` route handlers (`publicReads.ts`); the
 * signed-in user's own reads are the `api/me` ones (`sessionReads.ts`).
 */

import { assertRegionId } from "./regionArgument";
import { routeSummariesInRegion } from "./routeQueries";
import type { RegionId } from "./shared/regions";
import type { RouteSummary } from "./shared/types";

/** Every route in a region, without geometry (see RouteSummary). No authentication required. */
export async function getRouteSummaries(region: RegionId): Promise<RouteSummary[]> {
  assertRegionId(region);
  return routeSummariesInRegion(region);
}
