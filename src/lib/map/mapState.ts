/**
 * Utilities for persisting map state across page navigations
 */

export interface MapState {
  center: [number, number];
  zoom: number;
}

const MAP_STATE_KEY = 'railway-map-state';

/**
 * Save map state to localStorage
 */
export function saveMapState(state: MapState): void {
  try {
    localStorage.setItem(MAP_STATE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to save map state:', error);
  }
}

/**
 * Load map state from localStorage
 */
export function loadMapState(): MapState | null {
  try {
    const stored = localStorage.getItem(MAP_STATE_KEY);
    if (!stored) return null;

    const state = JSON.parse(stored) as MapState;

    // Validate the state
    if (
      Array.isArray(state.center) &&
      state.center.length === 2 &&
      typeof state.center[0] === 'number' &&
      typeof state.center[1] === 'number' &&
      typeof state.zoom === 'number'
    ) {
      return state;
    }

    return null;
  } catch (error) {
    console.warn('Failed to load map state:', error);
    return null;
  }
}

/**
 * Clear map state from localStorage
 */
export function clearMapState(): void {
  try {
    localStorage.removeItem(MAP_STATE_KEY);
  } catch (error) {
    console.warn('Failed to clear map state:', error);
  }
}
