"use server";

/**
 * The web app's trip server actions: resolve the session, delegate to
 * `tripQueries.ts`. The queries are a plain module so the mobile API's route
 * handlers can call them after resolving a bearer token instead
 * (MOBILE_APP_PLAN.md, Phase 1).
 *
 * `asUser` returns the queries' thrown rejections as an `ActionResult`, so a call
 * site reads it through `unwrap`. The reads are route handlers instead
 * (`api/me`, called through `sessionReads.ts`), because Next runs a client's
 * actions one at a time.
 */

import type { ActionResult } from "./actionResult";
import { asUser } from "./authHelpers";
import type { Trip } from "./shared/types";
import {
  assignJourneyToTripForUser,
  createTripForUser,
  deleteTripForUser,
  type JourneyWithStats,
  type TripName,
  type TripsAndJourneysItem,
  type TripWithStats,
  updateTripForUser,
} from "./tripQueries";

export type { JourneyWithStats, TripName, TripsAndJourneysItem, TripWithStats };

export async function createTrip(
  name: string,
  description: string | null,
): Promise<ActionResult<Trip>> {
  return asUser((userId) => createTripForUser(userId, name, description));
}

/** Update trip metadata (name, description). */
export async function updateTrip(
  tripId: number,
  name: string,
  description: string | null,
): Promise<ActionResult<Trip>> {
  return asUser((userId) => updateTripForUser(userId, tripId, name, description));
}

/** Delete a trip (journeys get unassigned via ON DELETE SET NULL). */
export async function deleteTrip(tripId: number): Promise<ActionResult<void>> {
  return asUser((userId) => deleteTripForUser(userId, tripId));
}

export async function assignJourneyToTrip(
  journeyId: number,
  tripId: number,
): Promise<ActionResult<void>> {
  return asUser((userId) => assignJourneyToTripForUser(userId, journeyId, tripId));
}
