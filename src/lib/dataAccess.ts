'use client';

/**
 * Data Access Abstraction Layer
 * Provides unified interface that switches between localStorage and database
 * based on authentication state
 */

import type { User } from './authActions';
import type { UserTrip, LocalTrip, RailwayRoute } from './types';
import { LocalStorageManager } from './localStorage';
import {
  getUserTrips as dbGetUserTrips,
  addUserTrip as dbAddUserTrip,
  updateUserTrip as dbUpdateUserTrip,
  deleteUserTrip as dbDeleteUserTrip,
  updateMultipleRoutes as dbUpdateMultipleRoutes,
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
  // Trip operations
  getUserTrips(trackId: string): Promise<UserTrip[]>;
  addUserTrip(trackId: string, date: string, note?: string | null, partial?: boolean): Promise<void>;
  updateUserTrip(tripId: number | string, date: string, note?: string | null, partial?: boolean): Promise<void>;
  deleteUserTrip(tripId: number | string): Promise<void>;
  updateMultipleRoutes(trackIds: number[], date: string, note: string | null, partialValues: boolean[]): Promise<void>;

  // Progress operations
  getUserProgress(selectedCountries?: string[]): Promise<UserProgress>;
  getProgressByCountry(): Promise<ProgressByCountry>;

  // Preferences operations
  getUserPreferences(): Promise<string[]>;
  updateUserPreferences(selectedCountries: string[]): Promise<void>;

  // Utility
  getTripCount(): Promise<number>;
  canAddMoreTrips(): Promise<boolean>;
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
    async getUserTrips(trackId: string): Promise<UserTrip[]> {
      return await dbGetUserTrips(trackId);
    },

    async addUserTrip(trackId: string, date: string, note?: string | null, partial?: boolean): Promise<void> {
      await dbAddUserTrip(trackId, date, note, partial);
    },

    async updateUserTrip(tripId: number | string, date: string, note?: string | null, partial?: boolean): Promise<void> {
      if (typeof tripId === 'string') {
        throw new Error('Database trips use numeric IDs');
      }
      await dbUpdateUserTrip(tripId, date, note, partial);
    },

    async deleteUserTrip(tripId: number | string): Promise<void> {
      if (typeof tripId === 'string') {
        throw new Error('Database trips use numeric IDs');
      }
      await dbDeleteUserTrip(tripId);
    },

    async updateMultipleRoutes(trackIds: number[], date: string, note: string | null, partialValues: boolean[]): Promise<void> {
      await dbUpdateMultipleRoutes(trackIds, date, note, partialValues);
    },

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

    async getTripCount(): Promise<number> {
      // For database, we don't enforce a limit, so this always returns 0
      // This could be enhanced to return actual count if needed
      return 0;
    },

    async canAddMoreTrips(): Promise<boolean> {
      // Logged-in users have unlimited trips
      return true;
    },
  };
}

/**
 * LocalStorage-backed data access (for unlogged users)
 */
function createLocalStorageDataAccess(): DataAccess {
  // Cache for routes data (used for progress calculation)
  let routesCache: RailwayRoute[] | null = null;

  return {
    async getUserTrips(trackId: string): Promise<UserTrip[]> {
      const localTrips = LocalStorageManager.getTripsByTrackId(trackId);

      // Convert LocalTrip[] to UserTrip[] format (for compatibility)
      return localTrips.map(trip => ({
        id: trip.id, // Use UUID string for localStorage trips
        user_id: 0, // Dummy user ID
        track_id: parseInt(trip.track_id),
        date: trip.date,
        note: trip.note,
        partial: trip.partial,
        created_at: trip.created_at,
        updated_at: trip.created_at,
      }));
    },

    async addUserTrip(trackId: string, date: string, note?: string | null, partial?: boolean): Promise<void> {
      LocalStorageManager.addTrip({
        track_id: trackId,
        date,
        note: note || null,
        partial: partial ?? false,
      });
    },

    async updateUserTrip(tripId: number | string, date: string, note?: string | null, partial?: boolean): Promise<void> {
      if (typeof tripId !== 'string') {
        throw new Error('LocalStorage trips use string UUIDs');
      }

      // Find the trip to get track_id
      const allTrips = LocalStorageManager.getTrips();
      const existingTrip = allTrips.find(t => t.id === tripId);

      if (!existingTrip) {
        throw new Error(`Trip with id ${tripId} not found`);
      }

      LocalStorageManager.updateTrip(tripId, {
        date,
        note: note || null,
        partial: partial ?? false,
      });
    },

    async deleteUserTrip(tripId: number | string): Promise<void> {
      if (typeof tripId !== 'string') {
        throw new Error('LocalStorage trips use string UUIDs');
      }

      LocalStorageManager.deleteTrip(tripId);
    },

    async updateMultipleRoutes(trackIds: number[], date: string, note: string | null, partialValues: boolean[]): Promise<void> {
      // Add trips for each route
      for (let i = 0; i < trackIds.length; i++) {
        const trackId = trackIds[i].toString();
        const partial = partialValues[i] ?? false;

        LocalStorageManager.addTrip({
          track_id: trackId,
          date,
          note,
          partial,
        });
      }
    },

    async getUserProgress(selectedCountries?: string[]): Promise<UserProgress> {
      try {
        // Fetch all routes if not cached
        if (!routesCache) {
          routesCache = await getAllRoutes();
        }

        const allRoutes = routesCache || [];
        const localTrips = LocalStorageManager.getTrips();

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

        // Find completed routes (routes with at least one complete trip)
        const completedRouteIds = new Set<string>();
        for (const trip of localTrips) {
          // Only count trips with date and not partial
          if (trip.date && !trip.partial) {
            completedRouteIds.add(trip.track_id);
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
        const localTrips = LocalStorageManager.getTrips();

        // Find completed routes
        const completedRouteIds = new Set<string>();
        for (const trip of localTrips) {
          if (trip.date && !trip.partial) {
            completedRouteIds.add(trip.track_id);
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

    async getTripCount(): Promise<number> {
      return LocalStorageManager.getTripCount();
    },

    async canAddMoreTrips(): Promise<boolean> {
      return LocalStorageManager.canAddMoreTrips();
    },
  };
}
