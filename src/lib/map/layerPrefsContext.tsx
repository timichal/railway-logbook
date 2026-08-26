"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { type LayerPrefs, loadLayerPrefs, saveLayerPref } from "./layerPrefs";

/**
 * The user map's layer toggles, held above the map.
 *
 * They used to live in two places — `showHeritage`/`showSpecial` inside
 * `useRouteEditor`, `showScenicOutline` as its own `useState` copied into both map
 * components — which was fine while the only control was inside the map itself. It
 * stopped being fine when the switches moved into `MenuSheet`: the menu is a
 * sibling of the map, so a toggle there has to re-render the map, and two hooks
 * reading the same localStorage key would simply disagree.
 *
 * `loadLayerPrefs` is read in the initializer, which returns the defaults on the
 * server. Nothing rendered during SSR consumes these (the map is `ssr: false`, the
 * menu is mobile-and-open only), so the client's first render picks up the stored
 * values with no hydration mismatch.
 */

interface LayerPrefsContextValue extends LayerPrefs {
  toggle: (key: keyof LayerPrefs) => void;
}

const LayerPrefsContext = createContext<LayerPrefsContextValue | null>(null);

export function LayerPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<LayerPrefs>(loadLayerPrefs);

  // Flip and persist only; the layer filters and visibility are applied by
  // useLayerFilters (single source of truth) reacting to the change.
  const toggle = useCallback((key: keyof LayerPrefs) => {
    setPrefs((prev) => {
      const next = !prev[key];
      saveLayerPref(key, next);
      return { ...prev, [key]: next };
    });
  }, []);

  const value = useMemo(() => ({ ...prefs, toggle }), [prefs, toggle]);

  return <LayerPrefsContext.Provider value={value}>{children}</LayerPrefsContext.Provider>;
}

export function useLayerPrefs(): LayerPrefsContextValue {
  const value = useContext(LayerPrefsContext);
  if (!value) throw new Error("useLayerPrefs must be used within a LayerPrefsProvider");
  return value;
}
