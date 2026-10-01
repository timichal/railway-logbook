"use server";

/**
 * The web app's journey server actions: resolve the session, delegate to
 * `journeyQueries.ts`. The queries are a plain module so the mobile API's route
 * handlers can call them after resolving a bearer token instead
 * (MOBILE_APP_PLAN.md, Phase 1).
 *
 * The queries report failure in-band, for the API's sake; these return it as an
 * `ActionResult` like every other action (`inBand`, `asUser`), so a call site
 * reads it through `unwrap`.
 */

import { type ActionResult, inBand } from "./actionResult";
import { asUser } from "./authHelpers";
import {
  createJourneyForUser,
  deleteJourneyForUser,
  type JourneyEdits,
  journeyForUser,
  type LoggedRange,
  saveJourneyEditsForUser,
} from "./journeyQueries";
import { routeBoundsByIds } from "./routeQueries";
import type { RegionId } from "./shared/regions";
import type { Journey, RailwayRoute, RouteBounds } from "./shared/types";

/**
 * Get a single journey with all its logged routes, and the bounds of those in
 * `region` — what the map fits to when the journey is opened, returned here so it
 * needs no request of its own.
 */
export async function getJourney(
  journeyId: number,
  region: RegionId,
): Promise<
  ActionResult<{ journey: Journey | null; routes: RailwayRoute[]; bounds: RouteBounds | null }>
> {
  return asUser(async (userId) => {
    const result = inBand(await journeyForUser(userId, journeyId));
    const trackIds = result.routes.map((r) => r.track_id);
    return { ...result, bounds: await routeBoundsByIds(trackIds, region) };
  });
}

/** Create a new journey and log routes to it (atomic operation). */
export async function createJourney(
  name: string,
  description: string | null,
  date: string, // YYYY-MM-DD
  trackIds: number[],
  partialFlags: boolean[],
  tripId?: number | null,
  coveredRanges?: (LoggedRange | null)[],
): Promise<ActionResult<{ journey: Journey | null }>> {
  return asUser(async (userId) =>
    inBand(
      await createJourneyForUser(
        userId,
        name,
        description,
        date,
        trackIds,
        partialFlags,
        tripId,
        coveredRanges,
      ),
    ),
  );
}

/**
 * Save an edited journey — metadata, trip, routes and partial flags — in one
 * transaction, so a failure leaves it exactly as it was.
 */
export async function saveJourneyEdits(
  journeyId: number,
  edits: JourneyEdits,
): Promise<ActionResult<void>> {
  return asUser(async (userId) => {
    inBand(await saveJourneyEditsForUser(userId, journeyId, edits));
  });
}

/** Delete a journey and all its logged parts. */
export async function deleteJourney(journeyId: number): Promise<ActionResult<void>> {
  return asUser(async (userId) => {
    inBand(await deleteJourneyForUser(userId, journeyId));
  });
}
