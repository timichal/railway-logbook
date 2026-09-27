"use server";

/**
 * The web app's trip server actions: resolve the session, delegate to
 * `tripQueries.ts`. The queries are a plain module so the mobile API's route
 * handlers can call them after resolving a bearer token instead
 * (MOBILE_APP_PLAN.md, Phase 1).
 *
 * The queries report failure in-band, for the API's sake; these return it as an
 * `ActionResult` like every other action (`inBand`, `asUser`), so a call site
 * reads it through `unwrap`.
 */

import { type ActionResult, inBand } from "./actionResult";
import { asUser } from "./authHelpers";
import type { RegionId } from "./shared/regions";
import type { Trip } from "./shared/types";
import {
  assignJourneyToTripForUser,
  createTripForUser,
  deleteTripForUser,
  type JourneyInTrip,
  journeysAndTripsForUser,
  type StandaloneJourneyWithStats,
  type TripsAndJourneysItem,
  type TripWithStats,
  tripForUser,
  tripsForUser,
  unassignedJourneysForUser,
  updateTripForUser,
} from "./tripQueries";

export type { JourneyInTrip, StandaloneJourneyWithStats, TripsAndJourneysItem, TripWithStats };

/** All of the current user's trips with computed stats, scoped to `region`. */
export async function getAllTrips(
  region: RegionId,
): Promise<ActionResult<{ trips: TripWithStats[] }>> {
  return asUser(async (userId) => inBand(await tripsForUser(userId, region)));
}

/** Get a single trip with its assigned journeys. */
export async function getTrip(tripId: number): Promise<
  ActionResult<{
    trip: Trip | null;
    journeys: JourneyInTrip[];
    routeIds: number[];
  }>
> {
  return asUser(async (userId) => inBand(await tripForUser(userId, tripId)));
}

/** Create a new trip. */
export async function createTrip(
  name: string,
  description: string | null,
): Promise<ActionResult<{ trip: Trip | null }>> {
  return asUser(async (userId) => inBand(await createTripForUser(userId, name, description)));
}

/** Update trip metadata (name, description). */
export async function updateTrip(
  tripId: number,
  name: string,
  description: string | null,
): Promise<ActionResult<{ trip: Trip | null }>> {
  return asUser(async (userId) =>
    inBand(await updateTripForUser(userId, tripId, name, description)),
  );
}

/** Delete a trip (journeys get unassigned via ON DELETE SET NULL). */
export async function deleteTrip(tripId: number): Promise<ActionResult<void>> {
  return asUser(async (userId) => {
    inBand(await deleteTripForUser(userId, tripId));
  });
}

/** Assign a journey to a trip. */
export async function assignJourneyToTrip(
  journeyId: number,
  tripId: number,
): Promise<ActionResult<void>> {
  return asUser(async (userId) => {
    inBand(await assignJourneyToTripForUser(userId, journeyId, tripId));
  });
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
  return asUser(async (userId) =>
    inBand(await journeysAndTripsForUser(userId, page, pageSize, search, region)),
  );
}

/** Journeys not assigned to any trip (for the assignment picker), scoped to `region`. */
export async function getUnassignedJourneys(
  region: RegionId,
): Promise<ActionResult<{ journeys: JourneyInTrip[] }>> {
  return asUser(async (userId) => inBand(await unassignedJourneysForUser(userId, region)));
}
