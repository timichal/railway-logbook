/**
 * LocalStorage access for storing journeys and preferences for unauthenticated users.
 * Max 5 journeys allowed, no limit on logged parts.
 *
 * Exposed as plain module functions; callers typically import the namespace
 * (`import * as localStore from "@/lib/localStorage"`).
 */

import { SUPPORTED_COUNTRIES } from "./constants";
import type { LocalJourney, LocalLoggedPart } from "./types";

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

const JOURNEYS_KEY = "railway_journeys";
const LOGGED_PARTS_KEY = "railway_logged_parts";
const PREFS_KEY = "railway_preferences";
const MAX_JOURNEYS = 5;
const DEFAULT_COUNTRIES = SUPPORTED_COUNTRIES.map((country) => country.code);

// ===== Journey Operations =====

/**
 * Get all journeys from localStorage
 */
export function getJourneys(): LocalJourney[] {
  if (typeof window === "undefined") return [];

  try {
    const data = localStorage.getItem(JOURNEYS_KEY);
    if (!data) return [];

    const parsed: LocalJourneysData = JSON.parse(data);
    return parsed.journeys || [];
  } catch (error) {
    console.error("Error reading journeys from localStorage:", error);
    return [];
  }
}

/**
 * Get a specific journey by ID
 */
export function getJourney(journeyId: string): LocalJourney | null {
  return getJourneys().find((j) => j.id === journeyId) || null;
}

/**
 * Add a new journey to localStorage
 * @throws Error if journey limit exceeded or quota exceeded
 */
export function addJourney(
  journey: Omit<LocalJourney, "id" | "created_at" | "updated_at">,
): LocalJourney {
  if (typeof window === "undefined") throw new Error("Cannot add journey on server");

  // Check limit before adding
  if (!canAddMoreJourneys()) {
    throw new Error("Journey limit reached (5/5). Please register to log more journeys.");
  }

  try {
    const journeys = getJourneys();
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

    localStorage.setItem(JOURNEYS_KEY, JSON.stringify(data));
    return newJourney;
  } catch (error) {
    if (error instanceof Error && error.name === "QuotaExceededError") {
      throw new Error("Storage limit reached. Please register to save more journeys.");
    }
    throw error;
  }
}

/**
 * Update an existing journey
 */
export function updateJourney(
  id: string,
  updates: Partial<Omit<LocalJourney, "id" | "created_at" | "updated_at">>,
): void {
  if (typeof window === "undefined") return;

  try {
    const journeys = getJourneys();
    const index = journeys.findIndex((journey) => journey.id === id);

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

    localStorage.setItem(JOURNEYS_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("Error updating journey in localStorage:", error);
    throw error;
  }
}

/**
 * Delete a journey and all its logged parts
 */
export function deleteJourney(id: string): void {
  if (typeof window === "undefined") return;

  try {
    // Delete journey
    const journeys = getJourneys();
    const filtered = journeys.filter((journey) => journey.id !== id);

    const data: LocalJourneysData = {
      version: 1,
      journeys: filtered,
    };

    localStorage.setItem(JOURNEYS_KEY, JSON.stringify(data));

    // Delete all logged parts for this journey
    const parts = getLoggedParts();
    const filteredParts = parts.filter((part) => part.journey_id !== id);

    const partsData: LocalLoggedPartsData = {
      version: 1,
      parts: filteredParts,
    };

    localStorage.setItem(LOGGED_PARTS_KEY, JSON.stringify(partsData));
  } catch (error) {
    console.error("Error deleting journey from localStorage:", error);
    throw error;
  }
}

/**
 * Get total journey count
 */
export function getJourneyCount(): number {
  return getJourneys().length;
}

/**
 * Check if user can add more journeys (under 5 limit)
 */
export function canAddMoreJourneys(): boolean {
  return getJourneyCount() < MAX_JOURNEYS;
}

/**
 * Clear all journeys
 */
export function clearJourneys(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(JOURNEYS_KEY);
  } catch (error) {
    console.error("Error clearing journeys from localStorage:", error);
  }
}

// ===== Logged Parts Operations =====

/**
 * Get all logged parts from localStorage
 */
export function getLoggedParts(): LocalLoggedPart[] {
  if (typeof window === "undefined") return [];

  try {
    const data = localStorage.getItem(LOGGED_PARTS_KEY);
    if (!data) return [];

    const parsed: LocalLoggedPartsData = JSON.parse(data);
    return parsed.parts || [];
  } catch (error) {
    console.error("Error reading logged parts from localStorage:", error);
    return [];
  }
}

/**
 * Get logged parts for a specific journey
 */
export function getLoggedPartsByJourneyId(journeyId: string): LocalLoggedPart[] {
  return getLoggedParts().filter((part) => part.journey_id === journeyId);
}

/**
 * Get all logged parts for a specific track (across all journeys)
 */
export function getLoggedPartsByTrackId(trackId: number): LocalLoggedPart[] {
  return getLoggedParts().filter((part) => part.track_id === trackId);
}

/**
 * Add a new logged part to localStorage
 * @throws Error if quota exceeded
 */
export function addLoggedPart(part: Omit<LocalLoggedPart, "id" | "created_at">): void {
  if (typeof window === "undefined") return;

  try {
    const parts = getLoggedParts();

    // Check if this route already exists in this journey
    const exists = parts.some(
      (p) => p.journey_id === part.journey_id && p.track_id === part.track_id,
    );

    if (exists) {
      throw new Error("This route is already logged in this journey");
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

    localStorage.setItem(LOGGED_PARTS_KEY, JSON.stringify(data));
  } catch (error) {
    if (error instanceof Error && error.name === "QuotaExceededError") {
      throw new Error("Storage limit reached. Please register to save more routes.");
    }
    throw error;
  }
}

/**
 * Add multiple logged parts at once (for creating a journey)
 */
export function addLoggedParts(parts: Omit<LocalLoggedPart, "id" | "created_at">[]): void {
  if (typeof window === "undefined") return;

  try {
    const existingParts = getLoggedParts();

    const newParts: LocalLoggedPart[] = parts.map((part) => ({
      ...part,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    }));

    const allParts = [...existingParts, ...newParts];

    const data: LocalLoggedPartsData = {
      version: 1,
      parts: allParts,
    };

    localStorage.setItem(LOGGED_PARTS_KEY, JSON.stringify(data));
  } catch (error) {
    if (error instanceof Error && error.name === "QuotaExceededError") {
      throw new Error("Storage limit reached. Please register to save more routes.");
    }
    throw error;
  }
}

/**
 * Update a logged part's partial flag
 */
export function updateLoggedPart(id: string, partial: boolean): void {
  if (typeof window === "undefined") return;

  try {
    const parts = getLoggedParts();
    const index = parts.findIndex((part) => part.id === id);

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

    localStorage.setItem(LOGGED_PARTS_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("Error updating logged part in localStorage:", error);
    throw error;
  }
}

/**
 * Delete a logged part
 */
export function deleteLoggedPart(id: string): void {
  if (typeof window === "undefined") return;

  try {
    const parts = getLoggedParts();
    const filtered = parts.filter((part) => part.id !== id);

    const data: LocalLoggedPartsData = {
      version: 1,
      parts: filtered,
    };

    localStorage.setItem(LOGGED_PARTS_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("Error deleting logged part from localStorage:", error);
    throw error;
  }
}

/**
 * Clear all logged parts
 */
export function clearLoggedParts(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(LOGGED_PARTS_KEY);
  } catch (error) {
    console.error("Error clearing logged parts from localStorage:", error);
  }
}

// ===== Preferences Operations =====

/**
 * Get country preferences from localStorage
 */
export function getPreferences(): string[] {
  if (typeof window === "undefined") return DEFAULT_COUNTRIES;

  try {
    const data = localStorage.getItem(PREFS_KEY);
    if (!data) return DEFAULT_COUNTRIES;

    const parsed: LocalPreferencesData = JSON.parse(data);
    return parsed.selected_countries || DEFAULT_COUNTRIES;
  } catch (error) {
    console.error("Error reading preferences from localStorage:", error);
    return DEFAULT_COUNTRIES;
  }
}

/**
 * Save country preferences to localStorage
 */
export function setPreferences(countries: string[]): void {
  if (typeof window === "undefined") return;

  try {
    const data: LocalPreferencesData = {
      version: 1,
      selected_countries: countries,
    };

    localStorage.setItem(PREFS_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("Error saving preferences to localStorage:", error);
    throw error;
  }
}

/**
 * Clear preferences
 */
export function clearPreferences(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(PREFS_KEY);
  } catch (error) {
    console.error("Error clearing preferences from localStorage:", error);
  }
}

/**
 * Export preferences for migration
 */
export function exportPreferences(): string[] {
  return getPreferences();
}

// ===== Export for Migration =====

/**
 * Export all journeys and logged parts for migration
 */
export function exportJourneysData(): { journeys: LocalJourney[]; parts: LocalLoggedPart[] } {
  return {
    journeys: getJourneys(),
    parts: getLoggedParts(),
  };
}

// ===== Multi-tab Sync =====

/**
 * Listen for storage changes in other tabs.
 * Returns cleanup function to remove listener.
 */
export function onStorageChange(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (event: StorageEvent) => {
    // Only trigger if railway data changed
    if (event.key === JOURNEYS_KEY || event.key === LOGGED_PARTS_KEY || event.key === PREFS_KEY) {
      callback();
    }
  };

  window.addEventListener("storage", handler);

  // Return cleanup function
  return () => {
    window.removeEventListener("storage", handler);
  };
}

// ===== Clear All Data =====

/**
 * Clear all railway data from localStorage
 */
export function clearAll(): void {
  clearJourneys();
  clearLoggedParts();
  clearPreferences();
}
