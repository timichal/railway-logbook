"use server";

/**
 * The web app's trip server actions: resolve the session, delegate to
 * `tripQueries.ts`. The queries are a plain module so the mobile API's route
 * handlers can call them after resolving a bearer token instead
 * (MOBILE_APP_PLAN.md, Phase 1).
 */

import { getUser } from "./authActions";
import type { RegionId } from "./regions";
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
  unassignJourneyFromTripForUser,
  updateTripForUser,
} from "./tripQueries";
import type { Trip } from "./types";

export type { JourneyInTrip, StandaloneJourneyWithStats, TripsAndJourneysItem, TripWithStats };

/** All of the current user's trips with computed stats, scoped to `region`. */
export async function getAllTrips(region: RegionId): Promise<{
  trips: TripWithStats[];
  error?: string;
}> {
  const user = await getUser();
  if (!user) {
    return { trips: [], error: "Not authenticated" };
  }

  return tripsForUser(user.id, region);
}

/** Get a single trip with its assigned journeys. */
export async function getTrip(tripId: number): Promise<{
  trip: Trip | null;
  journeys: JourneyInTrip[];
  routeIds: number[];
  error?: string;
}> {
  const user = await getUser();
  if (!user) {
    return { trip: null, journeys: [], routeIds: [], error: "Not authenticated" };
  }

  return tripForUser(user.id, tripId);
}

/** Create a new trip. */
export async function createTrip(
  name: string,
  description: string | null,
): Promise<{ trip: Trip | null; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { trip: null, error: "Not authenticated" };
  }

  return createTripForUser(user.id, name, description);
}

/** Update trip metadata (name, description). */
export async function updateTrip(
  tripId: number,
  name: string,
  description: string | null,
): Promise<{ trip: Trip | null; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { trip: null, error: "Not authenticated" };
  }

  return updateTripForUser(user.id, tripId, name, description);
}

/** Delete a trip (journeys get unassigned via ON DELETE SET NULL). */
export async function deleteTrip(tripId: number): Promise<{ success: boolean; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  return deleteTripForUser(user.id, tripId);
}

/** Assign a journey to a trip. */
export async function assignJourneyToTrip(
  journeyId: number,
  tripId: number,
): Promise<{ success: boolean; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  return assignJourneyToTripForUser(user.id, journeyId, tripId);
}

/** Unassign a journey from its trip (set trip_id = NULL). */
export async function unassignJourneyFromTrip(
  journeyId: number,
): Promise<{ success: boolean; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { success: false, error: "Not authenticated" };
  }

  return unassignJourneyFromTripForUser(user.id, journeyId);
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
): Promise<{ items: TripsAndJourneysItem[]; total: number; error?: string }> {
  const user = await getUser();
  if (!user) {
    return { items: [], total: 0, error: "Not authenticated" };
  }

  return journeysAndTripsForUser(user.id, page, pageSize, search, region);
}

/** Journeys not assigned to any trip (for the assignment picker), scoped to `region`. */
export async function getUnassignedJourneys(region: RegionId): Promise<{
  journeys: JourneyInTrip[];
  error?: string;
}> {
  const user = await getUser();
  if (!user) {
    return { journeys: [], error: "Not authenticated" };
  }

  return unassignedJourneysForUser(user.id, region);
}
