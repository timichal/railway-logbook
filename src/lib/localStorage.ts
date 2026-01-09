/**
 * LocalStorage manager for storing journeys and preferences for unauthenticated users
 * Max 5 journeys allowed, no limit on logged parts
 */

import { SUPPORTED_COUNTRIES } from './constants';
import type { LocalJourney, LocalLoggedPart } from './types';

interface LocalJourneysData {
  version: number;
  journeys: LocalJourney[];
}

interface LocalLoggedPartsData {
  version: number;
  parts: LocalLoggedPart[];
}

interface LocalPreferencesData {
  version: number;
  selected_countries: string[];
}

export class LocalStorageManager {
  private static readonly JOURNEYS_KEY = 'railway_journeys';
  private static readonly LOGGED_PARTS_KEY = 'railway_logged_parts';
  private static readonly PREFS_KEY = 'railway_preferences';
  private static readonly MAX_JOURNEYS = 5;
  private static readonly DEFAULT_COUNTRIES = SUPPORTED_COUNTRIES.map((country) => country.code);

  // ===== Journey Operations =====

  /**
   * Get all journeys from localStorage
   */
  static getJourneys(): LocalJourney[] {
    if (typeof window === 'undefined') return [];

    try {
      const data = localStorage.getItem(this.JOURNEYS_KEY);
      if (!data) return [];

      const parsed: LocalJourneysData = JSON.parse(data);
      return parsed.journeys || [];
    } catch (error) {
      console.error('Error reading journeys from localStorage:', error);
      return [];
    }
  }

  /**
   * Get a specific journey by ID
   */
  static getJourney(journeyId: string): LocalJourney | null {
    const journeys = this.getJourneys();
    return journeys.find(j => j.id === journeyId) || null;
  }

  /**
   * Add a new journey to localStorage
   * @throws Error if journey limit exceeded or quota exceeded
   */
  static addJourney(journey: Omit<LocalJourney, 'id' | 'created_at' | 'updated_at'>): LocalJourney {
    if (typeof window === 'undefined') throw new Error('Cannot add journey on server');

    // Check limit before adding
    if (!this.canAddMoreJourneys()) {
      throw new Error('Journey limit reached (5/5). Please register to log more journeys.');
    }

    try {
      const journeys = this.getJourneys();
      const newJourney: LocalJourney = {
        ...journey,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      journeys.push(newJourney);

      const data: LocalJourneysData = {
        version: 1,
        journeys,
      };

      localStorage.setItem(this.JOURNEYS_KEY, JSON.stringify(data));
      return newJourney;
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        throw new Error('Storage limit reached. Please register to save more journeys.');
      }
      throw error;
    }
  }

  /**
   * Update an existing journey
   */
  static updateJourney(id: string, updates: Partial<Omit<LocalJourney, 'id' | 'created_at' | 'updated_at'>>): void {
    if (typeof window === 'undefined') return;

    try {
      const journeys = this.getJourneys();
      const index = journeys.findIndex(journey => journey.id === id);

      if (index === -1) {
        throw new Error(`Journey with id ${id} not found`);
      }

      journeys[index] = {
        ...journeys[index],
        ...updates,
        updated_at: new Date().toISOString(),
      };

      const data: LocalJourneysData = {
        version: 1,
        journeys,
      };

      localStorage.setItem(this.JOURNEYS_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Error updating journey in localStorage:', error);
      throw error;
    }
  }

  /**
   * Delete a journey and all its logged parts
   */
  static deleteJourney(id: string): void {
    if (typeof window === 'undefined') return;

    try {
      // Delete journey
      const journeys = this.getJourneys();
      const filtered = journeys.filter(journey => journey.id !== id);

      const data: LocalJourneysData = {
        version: 1,
        journeys: filtered,
      };

      localStorage.setItem(this.JOURNEYS_KEY, JSON.stringify(data));

      // Delete all logged parts for this journey
      const parts = this.getLoggedParts();
      const filteredParts = parts.filter(part => part.journey_id !== id);

      const partsData: LocalLoggedPartsData = {
        version: 1,
        parts: filteredParts,
      };

      localStorage.setItem(this.LOGGED_PARTS_KEY, JSON.stringify(partsData));
    } catch (error) {
      console.error('Error deleting journey from localStorage:', error);
      throw error;
    }
  }

  /**
   * Get total journey count
   */
  static getJourneyCount(): number {
    return this.getJourneys().length;
  }

  /**
   * Check if user can add more journeys (under 5 limit)
   */
  static canAddMoreJourneys(): boolean {
    return this.getJourneyCount() < this.MAX_JOURNEYS;
  }

  /**
   * Clear all journeys
   */
  static clearJourneys(): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.removeItem(this.JOURNEYS_KEY);
    } catch (error) {
      console.error('Error clearing journeys from localStorage:', error);
    }
  }

  // ===== Logged Parts Operations =====

  /**
   * Get all logged parts from localStorage
   */
  static getLoggedParts(): LocalLoggedPart[] {
    if (typeof window === 'undefined') return [];

    try {
      const data = localStorage.getItem(this.LOGGED_PARTS_KEY);
      if (!data) return [];

      const parsed: LocalLoggedPartsData = JSON.parse(data);
      return parsed.parts || [];
    } catch (error) {
      console.error('Error reading logged parts from localStorage:', error);
      return [];
    }
  }

  /**
   * Get logged parts for a specific journey
   */
  static getLoggedPartsByJourneyId(journeyId: string): LocalLoggedPart[] {
    return this.getLoggedParts().filter(part => part.journey_id === journeyId);
  }

  /**
   * Get all logged parts for a specific track (across all journeys)
   */
  static getLoggedPartsByTrackId(trackId: number): LocalLoggedPart[] {
    return this.getLoggedParts().filter(part => part.track_id === trackId);
  }

  /**
   * Add a new logged part to localStorage
   * @throws Error if quota exceeded
   */
  static addLoggedPart(part: Omit<LocalLoggedPart, 'id' | 'created_at'>): void {
    if (typeof window === 'undefined') return;

    try {
      const parts = this.getLoggedParts();

      // Check if this route already exists in this journey
      const exists = parts.some(
        p => p.journey_id === part.journey_id && p.track_id === part.track_id
      );

      if (exists) {
        throw new Error('This route is already logged in this journey');
      }

      const newPart: LocalLoggedPart = {
        ...part,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      };

      parts.push(newPart);

      const data: LocalLoggedPartsData = {
        version: 1,
        parts,
      };

      localStorage.setItem(this.LOGGED_PARTS_KEY, JSON.stringify(data));
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        throw new Error('Storage limit reached. Please register to save more routes.');
      }
      throw error;
    }
  }

  /**
   * Add multiple logged parts at once (for creating a journey)
   */
  static addLoggedParts(parts: Omit<LocalLoggedPart, 'id' | 'created_at'>[]): void {
    if (typeof window === 'undefined') return;

    try {
      const existingParts = this.getLoggedParts();

      const newParts: LocalLoggedPart[] = parts.map(part => ({
        ...part,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      }));

      const allParts = [...existingParts, ...newParts];

      const data: LocalLoggedPartsData = {
        version: 1,
        parts: allParts,
      };

      localStorage.setItem(this.LOGGED_PARTS_KEY, JSON.stringify(data));
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        throw new Error('Storage limit reached. Please register to save more routes.');
      }
      throw error;
    }
  }

  /**
   * Update a logged part's partial flag
   */
  static updateLoggedPart(id: string, partial: boolean): void {
    if (typeof window === 'undefined') return;

    try {
      const parts = this.getLoggedParts();
      const index = parts.findIndex(part => part.id === id);

      if (index === -1) {
        throw new Error(`Logged part with id ${id} not found`);
      }

      parts[index] = {
        ...parts[index],
        partial,
      };

      const data: LocalLoggedPartsData = {
        version: 1,
        parts,
      };

      localStorage.setItem(this.LOGGED_PARTS_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Error updating logged part in localStorage:', error);
      throw error;
    }
  }

  /**
   * Delete a logged part
   */
  static deleteLoggedPart(id: string): void {
    if (typeof window === 'undefined') return;

    try {
      const parts = this.getLoggedParts();
      const filtered = parts.filter(part => part.id !== id);

      const data: LocalLoggedPartsData = {
        version: 1,
        parts: filtered,
      };

      localStorage.setItem(this.LOGGED_PARTS_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Error deleting logged part from localStorage:', error);
      throw error;
    }
  }

  /**
   * Clear all logged parts
   */
  static clearLoggedParts(): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.removeItem(this.LOGGED_PARTS_KEY);
    } catch (error) {
      console.error('Error clearing logged parts from localStorage:', error);
    }
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

  // ===== Export for Migration =====

  /**
   * Export all journeys and logged parts for migration
   */
  static exportJourneysData(): { journeys: LocalJourney[]; parts: LocalLoggedPart[] } {
    return {
      journeys: this.getJourneys(),
      parts: this.getLoggedParts(),
    };
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
      if (
        event.key === this.JOURNEYS_KEY ||
        event.key === this.LOGGED_PARTS_KEY ||
        event.key === this.PREFS_KEY
      ) {
        callback();
      }
    };

    window.addEventListener('storage', handler);

    // Return cleanup function
    return () => {
      window.removeEventListener('storage', handler);
    };
  }

  // ===== Clear All Data =====

  /**
   * Clear all railway data from localStorage
   */
  static clearAll(): void {
    this.clearJourneys();
    this.clearLoggedParts();
    this.clearPreferences();
  }
}
