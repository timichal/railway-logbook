"use server";

/**
 * The web app's trip server actions: resolve the session, delegate to
 * `tripQueries.ts`. The queries are a plain module so the mobile API's route
 * handlers can call them after resolving a bearer token instead
 * (MOBILE_APP_PLAN.md, Phase 1).
 *
 * `asUser` returns the queries' thrown rejections as an `ActionResult`, so a call
 * site reads it through `unwrap`.
 */

import type { ActionResult } from "./actionResult";
import { asUser } from "./authHelpers";
import { routeBoundsByIds } from "./routeQueries";
import type { RegionId } from "./shared/regions";
import type { RouteBounds, Trip } from "./shared/types";
import {
  assignJourneyToTripForUser,
  createTripForUser,
  deleteTripForUser,
  type JourneyInTrip,
  journeysAndTripsForUser,
  type TripsAndJourneysItem,
  type TripWithStats,
  tripForUser,
  tripsForUser,
  unassignedJourneysForUser,
  updateTripForUser,
} from "./tripQueries";

export type { JourneyInTrip, TripsAndJourneysItem, TripWithStats };

/** All of the current user's trips with computed stats, scoped to `region`. */
export async function getAllTrips(region: RegionId): Promise<ActionResult<TripWithStats[]>> {
  return asUser((userId) => tripsForUser(userId, region));
}

/**
 * Get a single trip with its assigned journeys, and the bounds of its routes in
 * `region` — what the map fits to when the trip is opened (see getJourney).
 */
export async function getTrip(
  tripId: number,
  region: RegionId,
): Promise<
  ActionResult<{
    trip: Trip;
    journeys: JourneyInTrip[];
    routeIds: number[];
    bounds: RouteBounds | null;
  }>
> {
  return asUser(async (userId) => {
    const result = await tripForUser(userId, tripId);
    return { ...result, bounds: await routeBoundsByIds(result.routeIds, region) };
  });
}

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

/**
 * A paginated, search-filtered page of top-level items (trips and standalone
 * journeys), sorted by effective date desc and scoped to `region`.
 */
export async function getJourneysAndTrips(
  page: number,
  pageSize: number,
  search: string,
  region: RegionId,
): Promise<ActionResult<{ items: TripsAndJourneysItem[]; total: number }>> {
  return asUser((userId) => journeysAndTripsForUser(userId, page, pageSize, search, region));
}

/** Journeys not assigned to any trip (for the assignment picker), scoped to `region`. */
export async function getUnassignedJourneys(
  region: RegionId,
): Promise<ActionResult<JourneyInTrip[]>> {
  return asUser((userId) => unassignedJourneysForUser(userId, region));
}
