/**
 * The signed-in web page's reads of its own data, from the `api/me` route
 * handlers rather than from server actions: Next runs a client's actions one at a
 * time, so as actions the page's loads queued behind each other and behind any
 * slow one. Writes stay server actions.
 *
 * A refusal is thrown as an `ActionError` (`fetchJson.ts`).
 */

import { getNoStore, listParam } from "./fetchJson";
import type { journeyWithBoundsForUser } from "./journeyQueries";
import type { ProgressByCountry, UserProgress } from "./shared/progress";
import type { RegionId } from "./shared/regions";
import type { CoveredStretch } from "./shared/types";
import type {
  JourneyWithStats,
  journeysAndTripsForUser,
  TripName,
  tripWithBoundsForUser,
} from "./tripQueries";

function getMine<T>(path: string, params: Record<string, string | undefined>): Promise<T> {
  return getNoStore(`/api/me/${path}`, params);
}

export function fetchProgress(
  region: RegionId,
  selectedCountries?: string[],
  shownUsageTypes?: readonly number[],
): Promise<UserProgress> {
  return getMine("progress", {
    region,
    countries: listParam(selectedCountries),
    usage: listParam(shownUsageTypes),
  });
}

export function fetchProgressByCountry(region: RegionId): Promise<ProgressByCountry> {
  return getMine("progress/by-country", { region });
}

export function fetchCoveredStretches(region: RegionId): Promise<CoveredStretch[]> {
  return getMine("coverage", { region });
}

export function fetchTripNames(region: RegionId): Promise<TripName[]> {
  return getMine("trip-names", { region });
}

/**
 * One page of My Trips. With `focusJourneyId`, the page that lists that journey,
 * whichever `page` asked (see journeysAndTripsForUser).
 */
export function fetchJourneysAndTrips(
  page: number,
  pageSize: number,
  search: string,
  region: RegionId,
  focusJourneyId: number | null = null,
): ReturnType<typeof journeysAndTripsForUser> {
  return getMine("logbook", {
    region,
    page: String(page),
    pageSize: String(pageSize),
    search: search || undefined,
    focus: focusJourneyId === null ? undefined : String(focusJourneyId),
  });
}

/** An opened trip: its journeys, routes, partial stretches and bounds in `region`. */
export function fetchTrip(
  tripId: number,
  region: RegionId,
): ReturnType<typeof tripWithBoundsForUser> {
  return getMine(`trips/${tripId}`, { region });
}

/**
 * An opened journey: its routes, their bounds in `region` and the stretches of
 * those ridden in part. A journey that is gone is an `ActionError` with `notFound`.
 */
export function fetchJourney(
  journeyId: number,
  region: RegionId,
): ReturnType<typeof journeyWithBoundsForUser> {
  return getMine(`journeys/${journeyId}`, { region });
}

/** The journeys in `region` filed under no trip, for a trip's assignment picker. */
export function fetchUnassignedJourneys(region: RegionId): Promise<JourneyWithStats[]> {
  return getMine("journeys/unassigned", { region });
}
