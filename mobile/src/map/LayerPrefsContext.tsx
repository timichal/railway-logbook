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
 * The stored form, and what it means in a region, are the web app's own
 * (`@shared/map/layerPrefs`): the Special switch is kept per region and starts on
 * where Special is ordinary service (Japan's non-JR lines). What a region *offers*
 * beyond that — `hasScenicHighlight` deciding whether the scenic lines are drawn at
 * all — is `LayerToggles`' business and the map's, not this store's.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type LayerPrefs,
  parseStoredLayerPrefs,
  resolveLayerPrefs,
  type StoredLayerPrefs,
  withLayerPref,
} from "@shared/map/layerPrefs";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRegion } from "@/region/RegionContext";

export type { LayerPrefs } from "@shared/map/layerPrefs";

const STORAGE_KEY = "railwayLogbook.layerPrefs";

interface LayerPrefsValue extends LayerPrefs {
  setPref(key: keyof LayerPrefs, value: boolean): void;
}

const LayerPrefsContext = createContext<LayerPrefsValue | null>(null);

export function LayerPrefsProvider({ children }: { children: ReactNode }): ReactNode {
  const { regionId } = useRegion();
  const [stored, setStored] = useState<StoredLayerPrefs>({});

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((json) => {
        if (!cancelled) setStored(parseStoredLayerPrefs(json));
      })
      .catch(() => {
        // The defaults are already what is on screen.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // No gate on hydration, unlike the region: before the read lands the region's
  // defaults are drawn, and a layer that changes a frame late is a layer changing,
  // not a wrong first paint.
  const setPref = useCallback(
    (key: keyof LayerPrefs, value: boolean) => {
      setStored((current) => {
        const next = withLayerPref(current, regionId, key, value);
        void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [regionId],
  );

  const value = useMemo(
    () => ({ ...resolveLayerPrefs(stored, regionId), setPref }),
    [stored, regionId, setPref],
  );

  return <LayerPrefsContext.Provider value={value}>{children}</LayerPrefsContext.Provider>;
}

export function useLayerPrefs(): LayerPrefsValue {
  const value = useContext(LayerPrefsContext);
  if (!value) throw new Error("useLayerPrefs must be used inside LayerPrefsProvider");
  return value;
}
