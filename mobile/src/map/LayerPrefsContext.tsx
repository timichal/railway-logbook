/**
 * The three layer switches — heritage, special, scenic — as the web app's
 * `LayerPrefsProvider` holds them.
 *
 * Held **above** the map for the same reason it is on the web: the switches live in
 * the Settings tab, which is a sibling of the map rather than a child, and two hooks
 * reading the same key would disagree. In `AsyncStorage` rather than
 * `user_preferences`, matching the web app's localStorage — it is the viewer's
 * choice, and needs no round trip to change.
 *
 * The stored value is region-agnostic, as on the web. What a region *offers* is not:
 * `hasScenicHighlight` decides whether the scenic outline is drawn at all, which is
 * `LayerToggles`' business and the map's, not this store's.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "railwayLogbook.layerPrefs";

export interface LayerPrefs {
  /** "Show heritage & tourist lines" — reveals Heritage routes (usage_type=1, dotted). */
  showHeritage: boolean;
  /** "Show special services" — reveals Special routes (usage_type=2, dashed). */
  showSpecial: boolean;
  /** "Highlight scenic lines" — amber outline under scenic routes. */
  showScenicOutline: boolean;
}

const DEFAULTS: LayerPrefs = {
  showHeritage: false,
  showSpecial: false,
  showScenicOutline: false,
};

interface LayerPrefsValue extends LayerPrefs {
  setPref<K extends keyof LayerPrefs>(key: K, value: LayerPrefs[K]): void;
}

const LayerPrefsContext = createContext<LayerPrefsValue | null>(null);

function parse(stored: string | null): LayerPrefs {
  if (!stored) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(stored) as Partial<LayerPrefs>;
    return {
      showHeritage: parsed.showHeritage ?? DEFAULTS.showHeritage,
      showSpecial: parsed.showSpecial ?? DEFAULTS.showSpecial,
      showScenicOutline: parsed.showScenicOutline ?? DEFAULTS.showScenicOutline,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function LayerPrefsProvider({ children }: { children: ReactNode }): ReactNode {
  const [prefs, setPrefs] = useState<LayerPrefs>(DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled) setPrefs(parse(stored));
      })
      .catch(() => {
        // Every default is "off", which is already what is on screen.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // No gate on hydration, unlike the region: all three default to off, and a layer
  // that appears a frame late is a layer appearing, not a wrong first paint.
  const setPref = useCallback(<K extends keyof LayerPrefs>(key: K, value: LayerPrefs[K]) => {
    setPrefs((current) => {
      const next = { ...current, [key]: value };
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <LayerPrefsContext.Provider value={{ ...prefs, setPref }}>
      {children}
    </LayerPrefsContext.Provider>
  );
}

export function useLayerPrefs(): LayerPrefsValue {
  const value = useContext(LayerPrefsContext);
  if (!value) throw new Error("useLayerPrefs must be used inside LayerPrefsProvider");
  return value;
}
