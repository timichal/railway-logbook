import type * as maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef } from "react";

interface UseSourceTileRefreshOptions {
  map: React.RefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  /** A vector source on the map. */
  sourceId: string;
  /**
   * Each new value is one refresh: a counter, or a key of the URL's own inputs so
   * that changing them is the refresh.
   */
  signal: number | string;
  /**
   * The tile URL's `v`. Owned by the caller so the map's construction can use the
   * latest one — a map rebuilt after a refresh must not go back to a URL from
   * before it; bumped here on every refresh. Undefined until the first one, for a
   * caller that builds its first source with no `v` at all.
   */
  cacheBusterRef: React.RefObject<number | undefined>;
  /** The source's tile URL for a given `v`. Read when a refresh runs, not before. */
  tileUrl: (cacheBuster: number) => string;
}

/**
 * Reloads one vector source's tiles whenever `signal` changes.
 *
 * **It points the existing source at a new URL (`setTiles`) rather than replacing
 * the source.** MapLibre then reloads the tiles in view while still drawing the
 * old ones, and everything attached to the source survives: the layers and their
 * order, the highlight overlays, the layer filters, the feature state, the layer
 * visibility. Removing and re-adding the source dropped all of that, and every
 * overlay had to watch for the refresh and put itself back.
 *
 * **It is applied on the next render, not at once.** A `setFilter` or layout change
 * on any layer of the source pauses the source's tiles until the style next
 * updates, and a `setTiles` landing in that window is lost: MapLibre drops the
 * "data changed" news while paused and on resuming only re-parses the tiles it
 * holds, without fetching. Logging a ride clears the selection's highlight filters
 * in the same commit as the refresh, so it hit that window every time — the
 * ridden route stayed unridden until a zoom loaded other tiles. A `render` comes
 * after the style update that resumes the tiles, and there `refreshTiles` refetches
 * them from the new URL at once — `setTiles` alone acts only a frame later (it
 * waits a frame before announcing the change), when the source may be paused
 * again. That reload then fetches the tiles a second time; a refresh is rare
 * enough for that not to matter.
 *
 * A refresh asked for while the map is still loading cannot be applied yet, and
 * the map under construction took its sources from a render before it — so it is
 * applied on load instead of dropped. The initial signal is what the map's own
 * construction already stands for. A map rebuilt later may stand for a newer one,
 * built from the inputs the signal keys; the returned `sourceBuilt(signal)`, called
 * from its sources factory, records that, so the rebuilt map isn't refreshed again
 * on load.
 */
export function useSourceTileRefresh({
  map,
  mapLoaded,
  sourceId,
  signal,
  cacheBusterRef,
  tileUrl,
}: UseSourceTileRefreshOptions): (signal: number | string) => void {
  const appliedRef = useRef(signal);

  // biome-ignore lint/correctness/useExhaustiveDependencies: signal is the trigger, and mapLoaded only catches up on one that arrived before the map could take it. tileUrl is read at refresh time and must not trigger a refresh of its own.
  useEffect(() => {
    const m = mapLoaded ? map.current : null;
    const source = m?.getSource<maplibregl.VectorTileSource>(sourceId);
    if (!m || !source || appliedRef.current === signal) return;
    appliedRef.current = signal;

    // The `v` must not repeat across page loads (a plain counter would) nor within
    // one (two refreshes in one millisecond would collapse into one). Bumped now,
    // so a map rebuilt before the render below still starts from the new one.
    cacheBusterRef.current = Math.max(Date.now(), (cacheBusterRef.current ?? 0) + 1);
    const url = tileUrl(cacheBusterRef.current);
    const apply = () => {
      source.setTiles([url]);
      // setTiles' own reload comes a frame later, open to the pause again
      m.refreshTiles(sourceId);
    };
    m.once("render", apply);
    m.triggerRepaint();
    return () => {
      m.off("render", apply);
    };
  }, [signal, mapLoaded]);

  return useCallback((built: number | string) => {
    appliedRef.current = built;
  }, []);
}
