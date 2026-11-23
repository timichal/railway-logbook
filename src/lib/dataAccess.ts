"use client";

/**
 * One interface over the three places a map's progress and preferences come
 * from: the database (signed in), localStorage (anonymous) and a share token.
 */

import * as localStore from "./localStorage";
import {
  getCoveredStretchesFor,
  getNetworkProgress,
  getNetworkProgressByCountry,
  getRouteSummaries,
} from "./publicReads";
import {
  fetchCoveredStretches,
  fetchProgress,
  fetchProgressByCountry,
  fetchRides,
} from "./sessionReads";
import type { UsageType } from "./shared/constants";
import { provisionalRides, type RouteRide, type RouteRides } from "./shared/map/routeRides";
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
  fetchSharedCoveredStretches,
  fetchSharedProgress,
  fetchSharedProgressByCountry,
  fetchSharedRides,
} from "./sharedMapReads";
import { updateUserPreferences as dbUpdateUserPreferences } from "./userPreferencesActions";

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
   * Every route ridden, for the map's colours (`RouteRide`): the route tile is the
   * same for everyone, and this is what says whose map it is. A refusal (a session
   * gone, a share link switched off) is an `ActionError`.
   */
  getRouteRides(): Promise<RouteRide[]>;

  /**
   * What the map may draw before `getRouteRides` answers, or if it can't, read
   * with nothing to load. For localStorage, every logged route kept on the map
   * uncoloured (`provisionalRides`). Null for the other two: their map draws no
   * routes until it knows the owner's rides, since uncoloured they would pass for
   * a map with nothing ridden.
   */
  getProvisionalRides(): RouteRides | null;

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
    // GET route handlers, not actions, so they run beside each other (sessionReads.ts)
    getUserProgress: (selectedCountries, shownUsageTypes) =>
      fetchProgress(region, selectedCountries, shownUsageTypes),
    getProgressByCountry: () => fetchProgressByCountry(region),
    getCoveredStretches: () => fetchCoveredStretches(region),
    getRouteRides: () => fetchRides(region),
    getProvisionalRides: () => null,
    updateUserPreferences: dbUpdateUserPreferences,
  };
}

function createLocalStorageDataAccess(region: RegionId): DataAccess {
  // This region's routes (used for progress calculation), asked for only once the
  // local log holds a ride: with an empty log, progress is the network's totals
  // (`getNetworkProgress`) and there is nothing to colour or draw. The promise is
  // what is cached, not its result: progress, the map colouring and the ridden
  // stretches all ask on mount, and caching the result let each of them start a
  // fetch of its own before the first one landed. A failure is forgotten so the
  // next caller retries.
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
  const fullyRiddenTrackIds = (routes: RouteSummary[], logged: LocalLoggedPart[]): Set<number> => {
    const partsByTrack = new Map<number, LocalLoggedPart[]>();
    for (const part of logged) {
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
      const logged = localStore.getLoggedParts();
      if (logged.length === 0) {
        return getNetworkProgress(region, selectedCountries, shownUsageTypes);
      }
      const allRoutes = await ensureRoutes();

      // Only the usage types the region counts as ordinary service (Regular, plus
      // Japan's non-JR lines) and the map shows, as progressForUser does. And the
      // same three-state country contract: undefined = no filter, [] = nothing
      // matches, [...] = those countries. Treating [] as "no filter" left the
      // progress box showing full network totals over a map the None button had
      // just emptied.
      const counted = countedUsageTypes(region, shownUsageTypes);
      // Never a closed route, as progressForUser
      const routes = allRoutes.filter(
        (route) =>
          !route.closed &&
          counted.includes(route.usage_type) &&
          (selectedCountries === undefined ||
            (route.start_country &&
              route.end_country &&
              selectedCountries.includes(route.start_country) &&
              selectedCountries.includes(route.end_country))),
      );

      const completedIds = fullyRiddenTrackIds(allRoutes, logged);
      const completed = routes.filter((route) => completedIds.has(route.track_id));

      return toUserProgress({
        totalKm: sumKm(routes),
        completedKm: sumKm(completed),
        totalRoutes: routes.length,
        completedRoutes: completed.length,
      });
    },

    async getProgressByCountry(): Promise<ProgressByCountry> {
      const logged = localStore.getLoggedParts();
      if (logged.length === 0) return getNetworkProgressByCountry(region);
      const allRoutes = await ensureRoutes();
      const completedIds = fullyRiddenTrackIds(allRoutes, logged);
      // The routes the region counts as ordinary service, as progressByCountryForUser
      // (open ones only)
      const counted = allRoutes.filter(
        (route) => !route.closed && isOrdinaryUsage(region, route.usage_type),
      );

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
      // (each with its stretch), on routes that aren't ridden whole (a route whose
      // stretches add up to all of it draws in the visited colour already). The
      // route list is asked for only where there is a stretch to check.
      const logged = localStore.getLoggedParts();
      const ranges: CoveredRange[] = [];
      for (const part of logged) {
        if (!part.partial) continue;
        if (part.covered_start == null || part.covered_end == null) continue;
        ranges.push({
          track_id: part.track_id,
          covered_start: part.covered_start,
          covered_end: part.covered_end,
        });
      }
      if (ranges.length === 0) return [];

      const completed = fullyRiddenTrackIds(await ensureRoutes(), logged);
      return await getCoveredStretchesFor(ranges.filter((range) => !completed.has(range.track_id)));
    },

    // Whole or not, and closed or not, need the route list; the most recent
    // journey is left to the signed-in map's popup
    async getRouteRides(): Promise<RouteRide[]> {
      const logged = localStore.getLoggedParts();
      if (logged.length === 0) return [];
      const routes = await ensureRoutes();
      const whole = fullyRiddenTrackIds(routes, logged);
      const closed = new Set(routes.filter((route) => route.closed).map((r) => r.track_id));
      return Array.from(new Set(logged.map((part) => part.track_id)), (trackId) => ({
        track_id: trackId,
        whole: whole.has(trackId),
        closed: closed.has(trackId),
        date: null,
        journey_name: null,
      }));
    },

    getProvisionalRides: () =>
      provisionalRides(localStore.getLoggedParts().map((part) => part.track_id)),

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
      fetchSharedProgress(token, region, selectedCountries, shownUsageTypes),
    getProgressByCountry: () => fetchSharedProgressByCountry(token, region),
    getCoveredStretches: () => fetchSharedCoveredStretches(token, region),
    // The owner's, never the visitor's: a visitor's own local log has no place here
    getRouteRides: () => fetchSharedRides(token, region),
    getProvisionalRides: () => null,

    // The shared view is handed the owner's list by the server component, and
    // has nowhere to change it
    async updateUserPreferences(): Promise<void> {
      throw new Error("A shared map is read-only");
    },
  };
}
