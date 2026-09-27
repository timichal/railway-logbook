"use server";

/**
 * The web app's journey server actions: resolve the session, delegate to
 * `journeyQueries.ts`. The queries are a plain module so the mobile API's route
 * handlers can call them after resolving a bearer token instead
 * (MOBILE_APP_PLAN.md, Phase 1).
 */

import { getUser } from "./authActions";
import {
  createJourneyForUser,
  deleteJourneyForUser,
  type JourneyEdits,
  journeyForUser,
  type LoggedRange,
  saveJourneyEditsForUser,
} from "./journeyQueries";
import type { Journey, RailwayRoute } from "./shared/types";

/** Get a single journey with all its logged routes. */
export async function getJourney(journeyId: number): Promise<{
  journey: Journey | null;
  routes: RailwayRoute[];
  error?: string;
}> {
  const user = await getUser();
  if (!user) {
    return { journey: null, routes: [], error: "Not authenticated" };
  }

  return journeyForUser(user.id, journeyId);
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
): Promise<{ journey: Journey | null; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { journey: null, error: "Not authenticated" };
  }

  return createJourneyForUser(
    user.id,
    name,
    description,
    date,
    trackIds,
    partialFlags,
    tripId,
    coveredRanges,
  );
}

/**
 * Save an edited journey — metadata, trip, routes and partial flags — in one
 * transaction, so a failure leaves it exactly as it was.
 */
export async function saveJourneyEdits(
  journeyId: number,
  edits: JourneyEdits,
): Promise<{ success: boolean; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  return saveJourneyEditsForUser(user.id, journeyId, edits);
}

/** Delete a journey and all its logged parts. */
export async function deleteJourney(
  journeyId: number,
): Promise<{ success: boolean; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  return deleteJourneyForUser(user.id, journeyId);
}
