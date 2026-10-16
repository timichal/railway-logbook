"use server";

/**
 * The web app's journey server actions: resolve the session, delegate to
 * `journeyQueries.ts`. The queries are a plain module so the mobile API's route
 * handlers can call them after resolving a bearer token instead
 * (MOBILE_APP_PLAN.md, Phase 1).
 *
 * `asUser` returns the queries' thrown rejections as an `ActionResult`, so a call
 * site reads it through `unwrap`.
 */

import type { ActionResult } from "./actionResult";
import { asUser } from "./authHelpers";
import {
  createJourneyForUser,
  deleteJourneyForUser,
  journeyWithBoundsForUser,
  type LoggedRange,
  saveJourneyEditsForUser,
} from "./journeyQueries";
import type { RegionId } from "./shared/regions";
import type {
  Journey,
  JourneyEdits,
  PartialRouteGeometry,
  RailwayRoute,
  RouteBounds,
} from "./shared/types";

/**
 * Get a single journey with all its logged routes, and the bounds of those in
 * `region` — what the map fits to when the journey is opened, returned here so it
 * needs no request of its own — and the stretches ridden of those logged in part,
 * which the highlight draws in place of the whole route.
 */
export async function getJourney(
  journeyId: number,
  region: RegionId,
): Promise<
  ActionResult<{
    journey: Journey;
    routes: RailwayRoute[];
    bounds: RouteBounds | null;
    partials: PartialRouteGeometry[];
  }>
> {
  return asUser((userId) => journeyWithBoundsForUser(userId, journeyId, region));
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
): Promise<ActionResult<Journey>> {
  return asUser((userId) =>
    createJourneyForUser(
      userId,
      name,
      description,
      date,
      trackIds,
      partialFlags,
      tripId,
      coveredRanges,
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
  return asUser((userId) => saveJourneyEditsForUser(userId, journeyId, edits));
}

/** Delete a journey and all its logged parts. */
export async function deleteJourney(journeyId: number): Promise<ActionResult<void>> {
  return asUser((userId) => deleteJourneyForUser(userId, journeyId));
}
