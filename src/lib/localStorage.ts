/**
 * LocalStorage manager for storing trips and preferences for unauthenticated users
 * Max 50 trips allowed
 */

import { SUPPORTED_COUNTRIES } from './constants';
import type { LocalTrip } from './types';

interface LocalTripsData {
  version: number;
  trips: LocalTrip[];
}

interface LocalPreferencesData {
  version: number;
  selected_countries: string[];
}

export class LocalStorageManager {
  private static readonly TRIPS_KEY = 'railway_trips';
  private static readonly PREFS_KEY = 'railway_preferences';
  private static readonly MAX_TRIPS = 50;
  private static readonly DEFAULT_COUNTRIES = SUPPORTED_COUNTRIES.map((country) => country.code);

  // ===== Trip Operations =====

  /**
   * Get all trips from localStorage
   */
  static getTrips(): LocalTrip[] {
    if (typeof window === 'undefined') return [];

    try {
      const data = localStorage.getItem(this.TRIPS_KEY);
      if (!data) return [];

      const parsed: LocalTripsData = JSON.parse(data);
      return parsed.trips || [];
    } catch (error) {
      console.error('Error reading trips from localStorage:', error);
      return [];
    }
  }

  /**
   * Get trips for a specific route
   */
  static getTripsByTrackId(trackId: string): LocalTrip[] {
    return this.getTrips().filter(trip => trip.track_id === trackId);
  }

  /**
   * Add a new trip to localStorage
   * @throws Error if trip limit exceeded or quota exceeded
   */
  static addTrip(trip: Omit<LocalTrip, 'id' | 'created_at'>): void {
    if (typeof window === 'undefined') return;

    // Check limit before adding
    if (!this.canAddMoreTrips()) {
      throw new Error('Trip limit reached (50/50). Please register to log more routes.');
    }

    try {
      const trips = this.getTrips();
      const newTrip: LocalTrip = {
        ...trip,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      };

      trips.push(newTrip);

      const data: LocalTripsData = {
        version: 1,
        trips,
      };

      localStorage.setItem(this.TRIPS_KEY, JSON.stringify(data));
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        throw new Error('Storage limit reached. Please register to save more trips.');
      }
      throw error;
    }
  }

  /**
   * Update an existing trip
   */
  static updateTrip(id: string, updates: Partial<Omit<LocalTrip, 'id' | 'created_at'>>): void {
    if (typeof window === 'undefined') return;

    try {
      const trips = this.getTrips();
      const index = trips.findIndex(trip => trip.id === id);

      if (index === -1) {
        throw new Error(`Trip with id ${id} not found`);
      }

      trips[index] = {
        ...trips[index],
        ...updates,
      };

      const data: LocalTripsData = {
        version: 1,
        trips,
      };

      localStorage.setItem(this.TRIPS_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Error updating trip in localStorage:', error);
      throw error;
    }
  }

  /**
   * Delete a trip
   */
  static deleteTrip(id: string): void {
    if (typeof window === 'undefined') return;

    try {
      const trips = this.getTrips();
      const filtered = trips.filter(trip => trip.id !== id);

      const data: LocalTripsData = {
        version: 1,
        trips: filtered,
      };

      localStorage.setItem(this.TRIPS_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Error deleting trip from localStorage:', error);
      throw error;
    }
  }

  /**
   * Get total trip count
   */
  static getTripCount(): number {
    return this.getTrips().length;
  }

  /**
   * Check if user can add more trips (under 50 limit)
   */
  static canAddMoreTrips(): boolean {
    return this.getTripCount() < this.MAX_TRIPS;
  }

  /**
   * Clear all trips
   */
  static clearTrips(): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.removeItem(this.TRIPS_KEY);
    } catch (error) {
      console.error('Error clearing trips from localStorage:', error);
    }
  }

  /**
   * Export all trips for migration
   */
  static exportTrips(): LocalTrip[] {
    return this.getTrips();
  }

  // ===== Preferences Operations =====

  /**
   * Get country preferences from localStorage
   */
  static getPreferences(): string[] {
    if (typeof window === 'undefined') return this.DEFAULT_COUNTRIES;

    try {
      const data = localStorage.getItem(this.PREFS_KEY);
      if (!data) return this.DEFAULT_COUNTRIES;

      const parsed: LocalPreferencesData = JSON.parse(data);
      return parsed.selected_countries || this.DEFAULT_COUNTRIES;
    } catch (error) {
      console.error('Error reading preferences from localStorage:', error);
      return this.DEFAULT_COUNTRIES;
    }
  }

  /**
   * Save country preferences to localStorage
   */
  static setPreferences(countries: string[]): void {
    if (typeof window === 'undefined') return;

    try {
      const data: LocalPreferencesData = {
        version: 1,
        selected_countries: countries,
      };

      localStorage.setItem(this.PREFS_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Error saving preferences to localStorage:', error);
      throw error;
    }
  }

  /**
   * Clear preferences
   */
  static clearPreferences(): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.removeItem(this.PREFS_KEY);
    } catch (error) {
      console.error('Error clearing preferences from localStorage:', error);
    }
  }

  /**
   * Export preferences for migration
   */
  static exportPreferences(): string[] {
    return this.getPreferences();
  }

  // ===== Multi-tab Sync =====

  /**
   * Listen for storage changes in other tabs
   * Returns cleanup function to remove listener
   */
  static onStorageChange(callback: () => void): () => void {
    if (typeof window === 'undefined') return () => {};

    const handler = (event: StorageEvent) => {
      // Only trigger if railway data changed
      if (event.key === this.TRIPS_KEY || event.key === this.PREFS_KEY) {
        callback();
      }
    };

    window.addEventListener('storage', handler);

    // Return cleanup function
    return () => {
      window.removeEventListener('storage', handler);
    };
  }
}
