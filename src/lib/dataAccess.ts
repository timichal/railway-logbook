"use client";

/**
 * One interface over the three places a map's progress and preferences come
 * from: the database (signed in), localStorage (anonymous) and a share token.
 */

import * as localStore from "./localStorage";
import {
  getPublicCoveredStretches,
  getPublicProgress,
  getPublicProgressByCountry,
} from "./publicMapActions";
import type { UsageType } from "./shared/constants";
import {
  type ProgressByCountry,
  round1,
  toUserProgress,
  type UserProgress,
} from "./shared/progress";
import { countedUsageTypes, isOrdinaryUsage, REGIONS, type RegionId } from "./shared/regions";
import { isRouteFullyRidden } from "./shared/routeCoverage";
import type { CoveredRange, CoveredStretch, LocalLoggedPart, RouteSummary } from "./shared/types";
import {
  getCoveredStretches as dbGetCoveredStretches,
  getProgressByCountry as dbGetProgressByCountry,
  getUserProgress as dbGetUserProgress,
  getCoveredStretchesFor,
  getRouteSummaries,
} from "./userActions";
import { updateUserPreferences as dbUpdateUserPreferences } from "./userPreferencesActions";

/** How one route reads on the map for a localStorage user (see getLocalRouteStatuses). */
export interface LocalRouteStatus {
  track_id: number;
  /** Ridden whole — logged complete, or partial stretches covering all of it. */
  complete: boolean;
}

export interface DataAccess {
  // `shownUsageTypes` narrows the count to the usage types the
  // map shows (`countedUsageTypes`); undefined counts all the region counts.
  getUserProgress(
    selectedCountries?: string[],
    shownUsageTypes?: UsageType[],
  ): Promise<UserProgress>;
  getProgressByCountry(): Promise<ProgressByCountry>;

  // Ridden stretches of routes that aren't finished yet (drawn as a map overlay)
  getCoveredStretches(): Promise<CoveredStretch[]>;

  /**
   * Visit status of every logged route, for the unauthenticated map to colour
   * routes with feature-state. Only the localStorage implementation has anything
   * to say here: the other two read it off the route tile, which the database
   * fills in per user (`has_complete_trip`).
   */
  getLocalRouteStatuses(): Promise<LocalRouteStatus[]>;

  updateUserPreferences(selectedCountries: string[]): Promise<void>;
}

/**
 * Every progress figure is scoped to one region: the map shows one at a time,
 * so the numbers beside it must count that region alone. The region is bound
 * here rather than threaded through each call, which also means switching
 * regions produces a fresh instance and drops the cached route list below.
 */
export function createDataAccess(userId: number | null, region: RegionId): DataAccess {
  return userId !== null ? createDatabaseDataAccess(region) : createLocalStorageDataAccess(region);
}

function createDatabaseDataAccess(region: RegionId): DataAccess {
  return {
    getUserProgress: (selectedCountries, shownUsageTypes) =>
      dbGetUserProgress(region, selectedCountries, shownUsageTypes),
    getProgressByCountry: () => dbGetProgressByCountry(region),
    getCoveredStretches: dbGetCoveredStretches,
    // The route tile already carries this user's visit status
    getLocalRouteStatuses: async () => [],
    updateUserPreferences: dbUpdateUserPreferences,
  };
}

function createLocalStorageDataAccess(region: RegionId): DataAccess {
  // This region's routes (used for progress calculation). The promise is what is
  // cached, not its result: progress, the map colouring and the ridden stretches
  // all ask on mount, and caching the result let each of them start a fetch of
  // its own before the first one landed. A failure is forgotten so the next
  // caller retries.
  let routesPromise: Promise<RouteSummary[]> | null = null;

  const ensureRoutes = (): Promise<RouteSummary[]> => {
    routesPromise ??= getRouteSummaries(region).catch((error) => {
      routesPromise = null;
      throw error;
    });
    return routesPromise;
  };

  /**
   * The routes the local log covers in full — logged whole, or with partial
   * stretches that add up to all of it (isRouteFullyRidden; the database side
   * of the same rule is the SQL function `user_fully_ridden_routes`). Route lengths
   * come from the route list, since the tolerance is in kilometres.
   */
  const fullyRiddenTrackIds = (routes: RouteSummary[]): Set<number> => {
    const partsByTrack = new Map<number, LocalLoggedPart[]>();
    for (const part of localStore.getLoggedParts()) {
      const parts = partsByTrack.get(part.track_id);
      if (parts) {
        parts.push(part);
      } else {
        partsByTrack.set(part.track_id, [part]);
      }
    }

    const lengths = new Map(routes.map((route) => [route.track_id, route.length_km]));
    const ridden = new Set<number>();
    for (const [trackId, parts] of partsByTrack) {
      if (isRouteFullyRidden(parts, lengths.get(trackId))) ridden.add(trackId);
    }
    return ridden;
  };

  const sumKm = (routes: RouteSummary[]) =>
    routes.reduce((sum, route) => sum + (route.length_km ?? 0), 0);

  return {
    async getUserProgress(selectedCountries, shownUsageTypes): Promise<UserProgress> {
      const allRoutes = await ensureRoutes();

      // Only the usage types the region counts as ordinary service (Regular, plus
      // Japan's non-JR lines) and the map shows, as progressForUser does. And the
      // same three-state country contract: undefined = no filter, [] = nothing
      // matches, [...] = those countries. Treating [] as "no filter" left the
      // progress box showing full network totals over a map the None button had
      // just emptied.
      const counted = countedUsageTypes(region, shownUsageTypes);
      const routes = allRoutes.filter(
        (route) =>
          counted.includes(route.usage_type) &&
          (selectedCountries === undefined ||
            (route.start_country &&
              route.end_country &&
              selectedCountries.includes(route.start_country) &&
              selectedCountries.includes(route.end_country))),
      );

      const completedIds = fullyRiddenTrackIds(allRoutes);
      const completed = routes.filter((route) => completedIds.has(route.track_id));

      return toUserProgress({
        totalKm: sumKm(routes),
        completedKm: sumKm(completed),
        totalRoutes: routes.length,
        completedRoutes: completed.length,
      });
    },

    async getProgressByCountry(): Promise<ProgressByCountry> {
      const allRoutes = await ensureRoutes();
      const completedIds = fullyRiddenTrackIds(allRoutes);
      // The routes the region counts as ordinary service, as progressByCountryForUser
      const counted = allRoutes.filter((route) => isOrdinaryUsage(region, route.usage_type));

      // Ridden against total km over some of them, rounded as the server rounds
      const kmOf = (routes: RouteSummary[]) => ({
        totalKm: round1(sumKm(routes)),
        completedKm: round1(sumKm(routes.filter((route) => completedIds.has(route.track_id)))),
      });

      // Each country: routes that both start AND end in it
      const byCountry = REGIONS[region].countries.map((country) => ({
        countryCode: country.code,
        countryName: country.name,
        ...kmOf(
          counted.filter(
            (route) => route.start_country === country.code && route.end_country === country.code,
          ),
        ),
      }));

      const byUsage = REGIONS[region].ordinaryUsageTypes.map((usageType) => ({
        usageType,
        ...kmOf(counted.filter((route) => route.usage_type === usageType)),
      }));

      return { byCountry, byUsage, total: kmOf(counted) };
    },

    async getCoveredStretches(): Promise<CoveredStretch[]> {
      // Same shape as the database query in getCoveredStretches: partial rides
      // with a known stretch, on routes that aren't ridden whole (a route whose
      // stretches add up to all of it draws in the visited colour already)
      const parts = localStore.getLoggedParts();
      const completed = fullyRiddenTrackIds(await ensureRoutes());

      const ranges: CoveredRange[] = [];
      for (const part of parts) {
        if (!part.partial) continue;
        if (part.covered_start == null || part.covered_end == null) continue;
        if (completed.has(part.track_id)) continue;
        ranges.push({
          track_id: part.track_id,
          covered_start: part.covered_start,
          covered_end: part.covered_end,
        });
      }

      if (ranges.length === 0) return [];
      return await getCoveredStretchesFor(ranges);
    },

    async getLocalRouteStatuses(): Promise<LocalRouteStatus[]> {
      const complete = fullyRiddenTrackIds(await ensureRoutes());
      const logged = new Set(localStore.getLoggedParts().map((part) => part.track_id));
      return Array.from(logged, (trackId) => ({
        track_id: trackId,
        complete: complete.has(trackId),
      }));
    },

    async updateUserPreferences(selectedCountries: string[]): Promise<void> {
      localStore.setPreferences(selectedCountries);
    },
  };
}

/**
 * Read-only data access for a shared public map (`/shared/<token>`).
 *
 * Same interface as the other two, so `useUserMap` works unchanged; the token
 * stands in for a session, and every call re-checks it server-side (a link
 * switched off mid-visit simply stops answering). Nothing here writes: an
 * anonymous visitor has no journeys to log and no preferences of their own, and
 * the country filter is the owner's, shown as they set it.
 */
export function createPublicDataAccess(token: string, region: RegionId): DataAccess {
  return {
    getUserProgress: (selectedCountries, shownUsageTypes) =>
      getPublicProgress(token, region, selectedCountries, shownUsageTypes),
    getProgressByCountry: () => getPublicProgressByCountry(token, region),
    getCoveredStretches: () => getPublicCoveredStretches(token),
    // The route tile is asked for the owner's status, and a visitor has no
    // local log of their own to overlay on it
    getLocalRouteStatuses: async () => [],

    // The shared view is handed the owner's list by the server component, and
    // has nowhere to change it
    async updateUserPreferences(): Promise<void> {
      throw new Error("A shared map is read-only");
    },
  };
}
