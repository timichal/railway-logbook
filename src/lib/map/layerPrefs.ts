/**
 * Persists user-map layer toggle preferences (the Map & Stats tab's switches) to
 * localStorage so they survive reloads and navigation. The stored form and what
 * it means in a region are `shared/map/layerPrefs.ts`, shared with the native app.
 *
 * Only used on the user map, which is loaded with `ssr: false`, so it is safe
 * to read these synchronously in a useState initializer.
 */

import {
  type LayerPrefs,
  parseStoredLayerPrefs,
  type StoredLayerPrefs,
  withLayerPref,
} from "@/lib/shared/map/layerPrefs";
import type { RegionId } from "@/lib/shared/regions";

export type { LayerPrefs } from "@/lib/shared/map/layerPrefs";

const LAYER_PREFS_KEY = "railway-map-layer-prefs";

export function loadLayerPrefs(): StoredLayerPrefs {
  if (typeof window === "undefined") return {};
  try {
    return parseStoredLayerPrefs(localStorage.getItem(LAYER_PREFS_KEY));
  } catch (error) {
    console.warn("Failed to load layer prefs:", error);
    return {};
  }
}

/**
 * Set one switch, merged into what is stored *now* rather than into this tab's
 * copy: another tab may have changed the others since this one loaded, and
 * writing a whole stale copy back would undo those.
 */
export function saveLayerPref(regionId: RegionId, key: keyof LayerPrefs, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const next = withLayerPref(loadLayerPrefs(), regionId, key, value);
    localStorage.setItem(LAYER_PREFS_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("Failed to save layer prefs:", error);
  }
}
