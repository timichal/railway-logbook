'use client';

/**
 * Data Access Abstraction Layer
 * Provides unified interface that switches between localStorage and database
 * based on authentication state
 */

import type { User } from './authActions';
import type { LocalTrip, RailwayRoute } from './types';
import { LocalStorageManager } from './localStorage';
import {
  getUserProgress as dbGetUserProgress,
  getProgressByCountry as dbGetProgressByCountry,
  getAllRoutes,
  type UserProgress,
  type ProgressByCountry,
} from './userActions';
import {
  getUserPreferences as dbGetUserPreferences,
  updateUserPreferences as dbUpdateUserPreferences,
} from './userPreferencesActions';
import { SUPPORTED_COUNTRIES } from './constants';

export interface DataAccess {
  // Progress operations
  getUserProgress(selectedCountries?: string[]): Promise<UserProgress>;
  getProgressByCountry(): Promise<ProgressByCountry>;

  // Preferences operations
  getUserPreferences(): Promise<string[]>;
  updateUserPreferences(selectedCountries: string[]): Promise<void>;

  // Utility (for localStorage users only)
  getJourneyCount(): Promise<number>;
  canAddMoreJourneys(): Promise<boolean>;
}

/**
 * Create data access layer based on authentication state
 * @param user - Current user object (null if not logged in)
 * @returns DataAccess implementation
 */
export function createDataAccess(user: User | null): DataAccess {
  if (user) {
    // User is logged in - use database operations
    return createDatabaseDataAccess();
  } else {
    // User is not logged in - use localStorage operations
    return createLocalStorageDataAccess();
  }
}

/**
 * Database-backed data access (for logged-in users)
 */
function createDatabaseDataAccess(): DataAccess {
  return {
    async getUserProgress(selectedCountries?: string[]): Promise<UserProgress> {
      return await dbGetUserProgress(selectedCountries);
    },

    async getProgressByCountry(): Promise<ProgressByCountry> {
      return await dbGetProgressByCountry();
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
function createLocalStorageDataAccess(): DataAccess {
  // Cache for routes data (used for progress calculation)
  let routesCache: RailwayRoute[] | null = null;

  return {
    async getUserProgress(selectedCountries?: string[]): Promise<UserProgress> {
      try {
        // Fetch all routes if not cached
        if (!routesCache) {
          routesCache = await getAllRoutes();
        }

        const allRoutes = routesCache || [];
        const localParts = LocalStorageManager.getLoggedParts();

        // Apply country filter if provided
        let filteredRoutes = allRoutes;
        if (selectedCountries !== undefined && selectedCountries.length > 0) {
          filteredRoutes = allRoutes.filter(route =>
            route.start_country &&
            route.end_country &&
            selectedCountries.includes(route.start_country) &&
            selectedCountries.includes(route.end_country)
          );
        }

        // Filter out Special routes (usage_type = 1)
        filteredRoutes = filteredRoutes.filter(route => route.usage_type !== 1);

        // Calculate totals
        const totalRoutes = filteredRoutes.length;
        const totalKm = filteredRoutes.reduce((sum, route) => sum + (Number(route.length_km) || 0), 0);

        // Find completed routes (routes with at least one complete logged part)
        const completedRouteIds = new Set<string>();
        for (const part of localParts) {
          // Only count parts that are not partial
          if (!part.partial) {
            completedRouteIds.add(String(part.track_id));
          }
        }

        const completedRoutes = filteredRoutes.filter(route =>
          completedRouteIds.has(route.track_id)
        );

        const completedRoutesCount = completedRoutes.length;
        const completedKm = completedRoutes.reduce((sum, route) => sum + (Number(route.length_km) || 0), 0);

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
        console.error('Error calculating progress for localStorage user:', error);
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
        // Fetch all routes if not cached
        if (!routesCache) {
          routesCache = await getAllRoutes();
        }

        const allRoutes = routesCache || [];
        const localParts = LocalStorageManager.getLoggedParts();

        // Find completed routes
        const completedRouteIds = new Set<string>();
        for (const part of localParts) {
          if (!part.partial) {
            completedRouteIds.add(String(part.track_id));
          }
        }

        // Calculate stats for each country
        const byCountry = SUPPORTED_COUNTRIES.map(country => {
          // Filter routes where BOTH start AND end are in this country (excluding Special)
          const countryRoutes = allRoutes.filter(route =>
            route.usage_type !== 1 &&
            route.start_country === country.code &&
            route.end_country === country.code
          );

          const totalKm = countryRoutes.reduce((sum, route) => sum + (Number(route.length_km) || 0), 0);

          const completedCountryRoutes = countryRoutes.filter(route =>
            completedRouteIds.has(route.track_id)
          );

          const completedKm = completedCountryRoutes.reduce((sum, route) => sum + (Number(route.length_km) || 0), 0);

          return {
            countryCode: country.code,
            countryName: country.name,
            totalKm: Math.round(totalKm * 10) / 10,
            completedKm: Math.round(completedKm * 10) / 10,
          };
        });

        // Calculate overall total (excluding Special)
        const allNonSpecialRoutes = allRoutes.filter(route => route.usage_type !== 1);
        const overallTotalKm = allNonSpecialRoutes.reduce((sum, route) => sum + (Number(route.length_km) || 0), 0);

        const overallCompletedRoutes = allNonSpecialRoutes.filter(route =>
          completedRouteIds.has(route.track_id)
        );
        const overallCompletedKm = overallCompletedRoutes.reduce((sum, route) => sum + (Number(route.length_km) || 0), 0);

        return {
          byCountry,
          total: {
            totalKm: Math.round(overallTotalKm * 10) / 10,
            completedKm: Math.round(overallCompletedKm * 10) / 10,
          },
        };
      } catch (error) {
        console.error('Error calculating progress by country for localStorage user:', error);
        // Return default values on error
        return {
          byCountry: SUPPORTED_COUNTRIES.map(country => ({
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

    async getUserPreferences(): Promise<string[]> {
      return LocalStorageManager.getPreferences();
    },

    async updateUserPreferences(selectedCountries: string[]): Promise<void> {
      LocalStorageManager.setPreferences(selectedCountries);
    },

    async getJourneyCount(): Promise<number> {
      return LocalStorageManager.getJourneyCount();
    },

    async canAddMoreJourneys(): Promise<boolean> {
      return LocalStorageManager.canAddMoreJourneys();
    },
  };
}
