"use server";

/**
 * The web app's user-facing server actions.
 *
 * Each one resolves the session and delegates: the public route and station
 * reads live in `routeQueries.ts`, the user-scoped progress and coverage SQL in
 * `progressQueries.ts`. Both are plain modules so the mobile API's route
 * handlers can call them after resolving a bearer token instead
 * (MOBILE_APP_PLAN.md, Phase 1).
 */

import { getUser } from "./authActions";
import {
  buildCoveredStretches,
  coveredStretchesForUser,
  normalizeCoveredRanges,
  type ProgressByCountry,
  progressByCountryForUser,
  progressForUser,
  type UserProgress,
} from "./progressQueries";
import type { RegionId } from "./regions";
import {
  routeMetadataByIds,
  routesInRegion,
  searchStationsByName,
  trackIdsInRegion,
} from "./routeQueries";
import type { CoveredRange, CoveredStretch, RailwayRoute, Station } from "./types";

/** Station name search for the map search box and the Journey Planner. */
export async function searchStations(searchQuery: string, region: RegionId): Promise<Station[]> {
  return searchStationsByName(searchQuery, region);
}

/** The track ids of every route in a region. */
export async function getRegionTrackIds(region: RegionId): Promise<number[]> {
  return trackIdsInRegion(region);
}

/** Every route in a region, geometry included. No authentication required. */
export async function getAllRoutes(region: RegionId): Promise<RailwayRoute[]> {
  return routesInRegion(region);
}

/** Metadata for a set of routes. No authentication required — route data is public. */
export async function getRoutesByIds(trackIds: number[]): Promise<RailwayRoute[]> {
  return routeMetadataByIds(trackIds);
}

/**
 * Progress figures for the logged-in user. The query itself lives in
 * `progressQueries.ts`, shared with the token-checked public-map version.
 */
export async function getUserProgress(
  region: RegionId,
  selectedCountries?: string[],
): Promise<UserProgress> {
  const user = await getUser();
  if (!user) {
    throw new Error("User not authenticated");
  }

  return progressForUser(user.id, region, selectedCountries);
}

/**
 * Get progress statistics broken down by country
 * Returns stats for each country (routes starting AND ending in that country)
 * Plus overall total across all countries
 */
export async function getProgressByCountry(region: RegionId): Promise<ProgressByCountry> {
  const user = await getUser();
  if (!user) {
    throw new Error("User not authenticated");
  }

  return progressByCountryForUser(user.id, region);
}

/**
 * The stretches the logged-in user has ridden on routes they haven't completed.
 */
export async function getCoveredStretches(): Promise<CoveredStretch[]> {
  const user = await getUser();
  if (!user) return [];

  return coveredStretchesForUser(user.id);
}

/**
 * Same as getCoveredStretches, for ranges the caller holds itself — the
 * localStorage journeys of a user who isn't logged in. Route geometry is public
 * (it is served as tiles to everyone), so this needs no authentication; the
 * ranges are validated and capped instead.
 */
export async function getCoveredStretchesFor(ranges: CoveredRange[]): Promise<CoveredStretch[]> {
  return buildCoveredStretches(normalizeCoveredRanges(ranges));
}
