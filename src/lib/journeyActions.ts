"use server";

/**
 * The web app's journey server actions: resolve the session, delegate to
 * `journeyQueries.ts`. The queries are a plain module so the mobile API's route
 * handlers can call them after resolving a bearer token instead
 * (MOBILE_APP_PLAN.md, Phase 1).
 */

import { getUser } from "./authActions";
import {
  addRoutesToJourneyForUser,
  createJourneyForUser,
  deleteJourneyForUser,
  journeyForUser,
  type LoggedRange,
  removeRouteFromJourneyForUser,
  updateJourneyForUser,
  updateLoggedPartPartialForUser,
} from "./journeyQueries";
import type { Journey, RailwayRoute } from "./types";

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

/** Update journey metadata (name, description, date). */
export async function updateJourney(
  journeyId: number,
  name: string,
  description: string | null,
  date: string,
): Promise<{ journey: Journey | null; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { journey: null, error: "Not authenticated" };
  }

  return updateJourneyForUser(user.id, journeyId, name, description, date);
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

/** Add routes to an existing journey. */
export async function addRoutesToJourney(
  journeyId: number,
  trackIds: number[],
  partialFlags: boolean[],
  coveredRanges?: (LoggedRange | null)[],
): Promise<{ success: boolean; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  return addRoutesToJourneyForUser(user.id, journeyId, trackIds, partialFlags, coveredRanges);
}

/** Remove a single route from a journey. */
export async function removeRouteFromJourney(
  journeyId: number,
  trackId: number,
): Promise<{ success: boolean; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  return removeRouteFromJourneyForUser(user.id, journeyId, trackId);
}

/** Toggle the partial flag for a logged part. */
export async function updateLoggedPartPartial(
  journeyId: number,
  trackId: number,
  partial: boolean,
): Promise<{ success: boolean; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  return updateLoggedPartPartialForUser(user.id, journeyId, trackId, partial);
}
