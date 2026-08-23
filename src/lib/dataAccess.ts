"use client";

/**
 * Data Access Abstraction Layer
 * Provides unified interface that switches between localStorage and database
 * based on authentication state
 */

import type { User } from "./authActions";
import { isSpecialUsage } from "./constants";
import * as localStore from "./localStorage";
import type { ProgressByCountry, UserProgress } from "./progressQueries";
import {
  getPublicCoveredStretches,
  getPublicProgress,
  getPublicProgressByCountry,
} from "./publicMapActions";
import { REGIONS, type RegionId } from "./regions";
import { isRouteFullyRidden } from "./routeCoverage";
import type { CoveredRange, CoveredStretch, LocalLoggedPart, RailwayRoute } from "./types";
import {
  getCoveredStretches as dbGetCoveredStretches,
  getProgressByCountry as dbGetProgressByCountry,
  getUserProgress as dbGetUserProgress,
  getAllRoutes,
  getCoveredStretchesFor,
} from "./userActions";
import {
  getUserPreferences as dbGetUserPreferences,
  updateUserPreferences as dbUpdateUserPreferences,
} from "./userPreferencesActions";

/** How one route reads on the map for a localStorage user (see getLocalRouteStatuses). */
export interface LocalRouteStatus {
  track_id: number;
  /** Ridden whole — logged complete, or partial stretches covering all of it. */
  complete: boolean;
}

export interface DataAccess {
  // Progress operations
  getUserProgress(selectedCountries?: string[]): Promise<UserProgress>;
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

  // Preferences operations
  getUserPreferences(): Promise<string[]>;
  updateUserPreferences(selectedCountries: string[]): Promise<void>;

  // Utility (for localStorage users only)
  getJourneyCount(): Promise<number>;
  canAddMoreJourneys(): Promise<boolean>;
}

/**
 * Create data access layer based on authentication state
 *
 * Every progress figure is scoped to one region: the map shows one at a time,
 * so the numbers beside it must count that region alone. The region is bound
 * here rather than threaded through each call, which also means switching
 * regions produces a fresh instance and drops the cached route list below.
 *
 * @param user - Current user object (null if not logged in)
 * @param region - The region currently being viewed
 * @returns DataAccess implementation
 */
export function createDataAccess(user: User | null, region: RegionId): DataAccess {
  if (user) {
    // User is logged in - use database operations
    return createDatabaseDataAccess(region);
  } else {
    // User is not logged in - use localStorage operations
    return createLocalStorageDataAccess(region);
  }
}

/**
 * Database-backed data access (for logged-in users)
 */
function createDatabaseDataAccess(region: RegionId): DataAccess {
  return {
    async getUserProgress(selectedCountries?: string[]): Promise<UserProgress> {
      return await dbGetUserProgress(region, selectedCountries);
    },

    async getProgressByCountry(): Promise<ProgressByCountry> {
      return await dbGetProgressByCountry(region);
    },

    async getCoveredStretches(): Promise<CoveredStretch[]> {
      return await dbGetCoveredStretches();
    },

    async getLocalRouteStatuses(): Promise<LocalRouteStatus[]> {
      // The route tile already carries this user's visit status
      return [];
    },

    async getUserPreferences(): Promise<string[]> {
      return await dbGetUserPreferences();
    },

    async updateUserPreferences(selectedCountries: string[]): Promise<void> {
      await dbUpdateUserPreferences(selectedCountries);
    },

    async getJourneyCount(): Promise<number> {
      // Logged-in users use database journeys (unlimited)
      return 0;
    },

    async canAddMoreJourneys(): Promise<boolean> {
      // Logged-in users have unlimited journeys
      return true;
    },
  };
}

/**
 * LocalStorage-backed data access (for unlogged users)
 * Note: Unlogged users still use the old localStorage trip system
 */
function createLocalStorageDataAccess(region: RegionId): DataAccess {
  // Cache of this region's routes (used for progress calculation)
  let routesCache: RailwayRoute[] | null = null;

  const ensureRoutes = async (): Promise<RailwayRoute[]> => {
    if (!routesCache) {
      routesCache = await getAllRoutes(region);
    }
    return routesCache || [];
  };

  /**
   * The routes the local log covers in full — logged whole, or with partial
   * stretches that add up to all of it (isRouteFullyRidden; the database side
   * of the same rule is the SQL function `user_fully_ridden_routes`). Route lengths
   * come from the route list, since the tolerance is in kilometres.
   */
  const fullyRiddenTrackIds = (routes: RailwayRoute[]): Set<number> => {
    const partsByTrack = new Map<number, LocalLoggedPart[]>();
    for (const part of localStore.getLoggedParts()) {
      const parts = partsByTrack.get(part.track_id);
      if (parts) {
        parts.push(part);
      } else {
        partsByTrack.set(part.track_id, [part]);
      }
    }

    const lengths = new Map(routes.map((route) => [route.track_id, Number(route.length_km)]));
    const ridden = new Set<number>();
    for (const [trackId, parts] of partsByTrack) {
      if (isRouteFullyRidden(parts, lengths.get(trackId))) ridden.add(trackId);
    }
    return ridden;
  };

  return {
    async getUserProgress(selectedCountries?: string[]): Promise<UserProgress> {
      try {
        const allRoutes = await ensureRoutes();

        // Apply country filter if provided
        let filteredRoutes = allRoutes;
        if (selectedCountries !== undefined && selectedCountries.length > 0) {
          filteredRoutes = allRoutes.filter(
            (route) =>
              route.start_country &&
              route.end_country &&
              selectedCountries.includes(route.start_country) &&
              selectedCountries.includes(route.end_country),
          );
        }

        // Filter out non-regular routes (Heritage + Special); only Regular counts.
        filteredRoutes = filteredRoutes.filter((route) => !isSpecialUsage(route.usage_type));

        // Calculate totals
        const totalRoutes = filteredRoutes.length;
        const totalKm = filteredRoutes.reduce(
          (sum, route) => sum + (Number(route.length_km) || 0),
          0,
        );

        const completedRouteIds = fullyRiddenTrackIds(allRoutes);

        const completedRoutes = filteredRoutes.filter((route) =>
          completedRouteIds.has(route.track_id),
        );

        const completedRoutesCount = completedRoutes.length;
        const completedKm = completedRoutes.reduce(
          (sum, route) => sum + (Number(route.length_km) || 0),
          0,
        );

        const percentage = totalKm > 0 ? (completedKm / totalKm) * 100 : 0;
        const routePercentage = totalRoutes > 0 ? (completedRoutesCount / totalRoutes) * 100 : 0;

        return {
          totalKm: Math.round(totalKm * 10) / 10,
          completedKm: Math.round(completedKm * 10) / 10,
          percentage: Math.round(percentage),
          routePercentage: Math.round(routePercentage),
          totalRoutes,
          completedRoutes: completedRoutesCount,
        };
      } catch (error) {
        console.error("Error calculating progress for localStorage user:", error);
        // Return default values on error
        return {
          totalKm: 0,
          completedKm: 0,
          percentage: 0,
          routePercentage: 0,
          totalRoutes: 0,
          completedRoutes: 0,
        };
      }
    },

    async getProgressByCountry(): Promise<ProgressByCountry> {
      try {
        const allRoutes = await ensureRoutes();
        const completedRouteIds = fullyRiddenTrackIds(allRoutes);

        // Calculate stats for each country
        const byCountry = REGIONS[region].countries.map((country) => {
          // Filter routes where BOTH start AND end are in this country (excluding special)
          const countryRoutes = allRoutes.filter(
            (route) =>
              !isSpecialUsage(route.usage_type) &&
              route.start_country === country.code &&
              route.end_country === country.code,
          );

          const totalKm = countryRoutes.reduce(
            (sum, route) => sum + (Number(route.length_km) || 0),
            0,
          );

          const completedCountryRoutes = countryRoutes.filter((route) =>
            completedRouteIds.has(route.track_id),
          );

          const completedKm = completedCountryRoutes.reduce(
            (sum, route) => sum + (Number(route.length_km) || 0),
            0,
          );

          return {
            countryCode: country.code,
            countryName: country.name,
            totalKm: Math.round(totalKm * 10) / 10,
            completedKm: Math.round(completedKm * 10) / 10,
          };
        });

        // Calculate overall total (excluding special)
        const allNonSpecialRoutes = allRoutes.filter((route) => !isSpecialUsage(route.usage_type));
        const overallTotalKm = allNonSpecialRoutes.reduce(
          (sum, route) => sum + (Number(route.length_km) || 0),
          0,
        );

        const overallCompletedRoutes = allNonSpecialRoutes.filter((route) =>
          completedRouteIds.has(route.track_id),
        );
        const overallCompletedKm = overallCompletedRoutes.reduce(
          (sum, route) => sum + (Number(route.length_km) || 0),
          0,
        );

        return {
          byCountry,
          total: {
            totalKm: Math.round(overallTotalKm * 10) / 10,
            completedKm: Math.round(overallCompletedKm * 10) / 10,
          },
        };
      } catch (error) {
        console.error("Error calculating progress by country for localStorage user:", error);
        // Return default values on error
        return {
          byCountry: REGIONS[region].countries.map((country) => ({
            countryCode: country.code,
            countryName: country.name,
            totalKm: 0,
            completedKm: 0,
          })),
          total: {
            totalKm: 0,
            completedKm: 0,
          },
        };
      }
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

    async getUserPreferences(): Promise<string[]> {
      return localStore.getPreferences();
    },

    async updateUserPreferences(selectedCountries: string[]): Promise<void> {
      localStore.setPreferences(selectedCountries);
    },

    async getJourneyCount(): Promise<number> {
      return localStore.getJourneyCount();
    },

    async canAddMoreJourneys(): Promise<boolean> {
      return localStore.canAddMoreJourneys();
    },
  };
}

/**
 * Read-only data access for a shared public map (`/shared/<token>`).
 *
 * Same interface as the other two, so `useRouteEditor` and `useCoverageOverlay`
 * work unchanged; the token stands in for a session, and every call re-checks it
 * server-side (a link switched off mid-visit simply stops answering). Nothing
 * here writes: an anonymous visitor has no journeys to log and no preferences of
 * their own, and the country filter is the owner's, shown as they set it.
 */
export function createPublicDataAccess(token: string, region: RegionId): DataAccess {
  return {
    async getUserProgress(selectedCountries?: string[]): Promise<UserProgress> {
      return await getPublicProgress(token, region, selectedCountries);
    },

    async getProgressByCountry(): Promise<ProgressByCountry> {
      return await getPublicProgressByCountry(token, region);
    },

    async getCoveredStretches(): Promise<CoveredStretch[]> {
      return await getPublicCoveredStretches(token);
    },

    async getLocalRouteStatuses(): Promise<LocalRouteStatus[]> {
      // The route tile is asked for the owner's status, and a visitor has no
      // local log of their own to overlay on it
      return [];
    },

    async getUserPreferences(): Promise<string[]> {
      // The shared view is handed the owner's list by the server component; it
      // never asks for it again, and it has nowhere to change it.
      throw new Error("A shared map has no editable preferences");
    },

    async updateUserPreferences(): Promise<void> {
      throw new Error("A shared map is read-only");
    },

    async getJourneyCount(): Promise<number> {
      return 0;
    },

    async canAddMoreJourneys(): Promise<boolean> {
      return false;
    },
  };
}
