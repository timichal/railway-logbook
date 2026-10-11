"use client";

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { useRegionId } from "@/lib/regionContext";
import { resolveLayerPrefs, withLayerPref } from "@/lib/shared/map/layerPrefs";
import { type LayerPrefs, loadLayerPrefs, saveLayerPref } from "./layerPrefs";

/**
 * The user map's layer toggles, held above the map.
 *
 * The switches are driven from `MenuSheet`, a sibling of the map rather than a
 * child of it, so a toggle there has to re-render the map — and two hooks reading
 * the same localStorage key would simply disagree.
 *
 * What is held is the stored form; the values handed out are resolved for the
 * current region, since the Special switch is kept per region and defaults per
 * region (see `shared/map/layerPrefs.ts`). Hence inside `RegionProvider`.
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
  const regionId = useRegionId();
  const [stored, setStored] = useState(loadLayerPrefs);
  const prefs = useMemo(() => resolveLayerPrefs(stored, regionId), [stored, regionId]);

  // Flip and persist only; the layer filters and visibility are applied by
  // useLayerFilters (single source of truth) reacting to the change.
  const toggle = useCallback(
    (key: keyof LayerPrefs) => {
      setStored((prev) => {
        const value = !resolveLayerPrefs(prev, regionId)[key];
        saveLayerPref(regionId, key, value);
        return withLayerPref(prev, regionId, key, value);
      });
    },
    [regionId],
  );

  const value = useMemo(() => ({ ...prefs, toggle }), [prefs, toggle]);

  return <LayerPrefsContext.Provider value={value}>{children}</LayerPrefsContext.Provider>;
}

export function useLayerPrefs(): LayerPrefsContextValue {
  const value = useContext(LayerPrefsContext);
  if (!value) throw new Error("useLayerPrefs must be used within a LayerPrefsProvider");
  return value;
}
