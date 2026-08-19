/**
 * Utilities for persisting map state across page navigations
 */

import type { RegionId } from "@/lib/regions";

export interface MapState {
  center: [number, number];
  zoom: number;
}

/**
 * One saved position per region: they are half a planet apart, so restoring
 * Europe's centre into the Japan view would land outside the map's bounds.
 * Switching regions therefore returns you to where you left that region.
 */
const mapStateKey = (region: RegionId) => `railway-map-state-${region}`;

/**
 * Save map state to localStorage
 */
export function saveMapState(state: MapState, region: RegionId): void {
  try {
    localStorage.setItem(mapStateKey(region), JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to save map state:", error);
  }
}

/**
 * Load map state from localStorage
 */
export function loadMapState(region: RegionId): MapState | null {
  try {
    const stored = localStorage.getItem(mapStateKey(region));
    if (!stored) return null;

    const state = JSON.parse(stored) as MapState;

    // Validate the state
    if (
      Array.isArray(state.center) &&
      state.center.length === 2 &&
      typeof state.center[0] === "number" &&
      typeof state.center[1] === "number" &&
      typeof state.zoom === "number"
    ) {
      return state;
    }

    return null;
  } catch (error) {
    console.warn("Failed to load map state:", error);
    return null;
  }
}
