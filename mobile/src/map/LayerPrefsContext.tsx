/**
 * The map's layer switches — the usage types, closed lines, scenic — as the web
 * app's `LayerPrefsProvider` holds them.
 *
 * Held **above** the map for the same reason it is on the web: the switches live in
 * the Settings tab and the Statistics screen (Japan's JR and non-JR lines), siblings
 * of the map rather than children, and two hooks reading the same key would
 * disagree. In `AsyncStorage` rather than
 * `user_preferences`, matching the web app's localStorage — it is the viewer's
 * choice, and needs no round trip to change.
 *
 * The stored form, and what it means in a region, are the web app's own
 * (`@shared/map/layerPrefs`): the Special and Regular switches are kept per region,
 * Special starts on where it is ordinary service (Japan's non-JR lines), and Regular
 * can be switched off only where it is not the only ordinary type. What a region *offers*
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
  useRef,
  useState,
} from "react";
import { useRegion } from "@/region/RegionContext";

export type { LayerPrefs } from "@shared/map/layerPrefs";

const STORAGE_KEY = "railwayLogbook.layerPrefs";

interface LayerPrefsValue extends LayerPrefs {
  /** Whether the stored switches have been read (or failed to be). */
  loaded: boolean;
  setPref(key: keyof LayerPrefs, value: boolean): void;
  toggle(key: keyof LayerPrefs): void;
}

const LayerPrefsContext = createContext<LayerPrefsValue | null>(null);

type Edit = (stored: StoredLayerPrefs) => StoredLayerPrefs;

export function LayerPrefsProvider({ children }: { children: ReactNode }): ReactNode {
  const { regionId } = useRegion();
  const [stored, setStored] = useState<StoredLayerPrefs>({});
  const [loaded, setLoaded] = useState(false);
  // Switches flipped before the stored ones were read, replayed over them once they
  // are, so a change made in that moment isn't overwritten by what was on disk
  const early = useRef<Edit[] | null>([]);
  // Whether anything has been switched at all: the read alone writes nothing back
  const changed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const settle = (fromDisk: StoredLayerPrefs) => {
      if (cancelled) return;
      const edits = early.current ?? [];
      early.current = null;
      setStored(edits.reduce((current, edit) => edit(current), fromDisk));
      setLoaded(true);
    };
    AsyncStorage.getItem(STORAGE_KEY)
      .then((json) => settle(parseStoredLayerPrefs(json)))
      // The defaults, then, which are already what is on screen
      .catch(() => settle({}));
    return () => {
      cancelled = true;
    };
  }, []);

  // Written from here rather than from inside a state updater, which React may run
  // twice. Before the read lands there is nothing whole to write.
  useEffect(() => {
    if (!loaded || !changed.current) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored)).catch(() => {
      // Kept for this session; the next launch starts from what was last written
    });
  }, [stored, loaded]);

  // No gate on hydration for drawing, unlike the region: before the read lands the
  // region's defaults are drawn, and a layer that changes a frame late is a layer
  // changing, not a wrong first paint. What fetches by the switches waits (`loaded`).
  const apply = useCallback((edit: Edit) => {
    changed.current = true;
    early.current?.push(edit);
    setStored(edit);
  }, []);

  const setPref = useCallback(
    (key: keyof LayerPrefs, value: boolean) =>
      apply((current) => withLayerPref(current, regionId, key, value)),
    [apply, regionId],
  );
  // Negated against the latest state, so two taps before a re-render are two flips
  const toggle = useCallback(
    (key: keyof LayerPrefs) =>
      apply((current) =>
        withLayerPref(current, regionId, key, !resolveLayerPrefs(current, regionId)[key]),
      ),
    [apply, regionId],
  );

  const value = useMemo(
    () => ({ ...resolveLayerPrefs(stored, regionId), loaded, setPref, toggle }),
    [stored, regionId, loaded, setPref, toggle],
  );

  return <LayerPrefsContext.Provider value={value}>{children}</LayerPrefsContext.Provider>;
}

export function useLayerPrefs(): LayerPrefsValue {
  const value = useContext(LayerPrefsContext);
  if (!value) throw new Error("useLayerPrefs must be used inside LayerPrefsProvider");
  return value;
}
