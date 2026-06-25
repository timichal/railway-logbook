/**
 * Persists user-map layer toggle preferences (the sidebar checkboxes) to
 * localStorage so they survive reloads and navigation.
 *
 * Only used on the user map, which is loaded with `ssr: false`, so it is safe
 * to read these synchronously in a useState initializer.
 */

export interface LayerPrefs {
  /** "Show special lines" — reveals Heritage (solid) + Diversion (dashed). */
  showSpecialLines: boolean;
  /** "Highlight scenic lines" — amber outline under scenic routes. */
  showScenicOutline: boolean;
}

const LAYER_PREFS_KEY = "railway-map-layer-prefs";

const DEFAULTS: LayerPrefs = {
  showSpecialLines: false,
  showScenicOutline: false,
};

export function loadLayerPrefs(): LayerPrefs {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const stored = localStorage.getItem(LAYER_PREFS_KEY);
    if (!stored) return { ...DEFAULTS };

    const parsed = JSON.parse(stored) as Partial<LayerPrefs>;
    return {
      showSpecialLines:
        typeof parsed.showSpecialLines === "boolean"
          ? parsed.showSpecialLines
          : DEFAULTS.showSpecialLines,
      showScenicOutline:
        typeof parsed.showScenicOutline === "boolean"
          ? parsed.showScenicOutline
          : DEFAULTS.showScenicOutline,
    };
  } catch (error) {
    console.warn("Failed to load layer prefs:", error);
    return { ...DEFAULTS };
  }
}

/** Update a single preference, merging with whatever else is stored. */
export function saveLayerPref<K extends keyof LayerPrefs>(key: K, value: LayerPrefs[K]): void {
  if (typeof window === "undefined") return;
  try {
    const next: LayerPrefs = { ...loadLayerPrefs(), [key]: value };
    localStorage.setItem(LAYER_PREFS_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("Failed to save layer prefs:", error);
  }
}
