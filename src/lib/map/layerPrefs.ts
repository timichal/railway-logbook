/**
 * Persists user-map layer toggle preferences (the sidebar checkboxes) to
 * localStorage so they survive reloads and navigation.
 *
 * Only used on the user map, which is loaded with `ssr: false`, so it is safe
 * to read these synchronously in a useState initializer.
 */

export interface LayerPrefs {
  /** "Show heritage lines" — reveals Heritage routes (usage_type=1, solid). */
  showHeritage: boolean;
  /** "Show special services" — reveals Special routes (usage_type=2, dashed). */
  showSpecial: boolean;
  /** "Highlight scenic lines" — amber outline under scenic routes. */
  showScenicOutline: boolean;
}

const LAYER_PREFS_KEY = "railway-map-layer-prefs";

const DEFAULTS: LayerPrefs = {
  showHeritage: false,
  showSpecial: false,
  showScenicOutline: false,
};

export function loadLayerPrefs(): LayerPrefs {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const stored = localStorage.getItem(LAYER_PREFS_KEY);
    if (!stored) return { ...DEFAULTS };

    // `showSpecialLines` is the legacy single toggle (Heritage + Diversion
    // together). When present and the new keys aren't, seed both from it.
    const parsed = JSON.parse(stored) as Partial<LayerPrefs> & { showSpecialLines?: boolean };
    const legacy =
      typeof parsed.showSpecialLines === "boolean" ? parsed.showSpecialLines : undefined;
    return {
      showHeritage:
        typeof parsed.showHeritage === "boolean"
          ? parsed.showHeritage
          : (legacy ?? DEFAULTS.showHeritage),
      showSpecial:
        typeof parsed.showSpecial === "boolean"
          ? parsed.showSpecial
          : (legacy ?? DEFAULTS.showSpecial),
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
