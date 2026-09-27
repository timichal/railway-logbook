import type * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";

interface UseSourceTileRefreshOptions {
  map: React.MutableRefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  /** A vector source on the map. */
  sourceId: string;
  /** Each new value is one refresh. */
  signal: number;
  /**
   * The tile URL's `v`. Owned by the caller so the map's construction can use the
   * latest one; bumped here on every refresh.
   */
  cacheBusterRef: React.MutableRefObject<number>;
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
 * A refresh asked for while the map is still loading cannot be applied yet, and
 * the map under construction took its sources from a render before it — so it is
 * applied on load instead of dropped. The initial signal is what the map's own
 * construction already stands for.
 */
export function useSourceTileRefresh({
  map,
  mapLoaded,
  sourceId,
  signal,
  cacheBusterRef,
  tileUrl,
}: UseSourceTileRefreshOptions) {
  const appliedRef = useRef(signal);

  // biome-ignore lint/correctness/useExhaustiveDependencies: signal is the trigger, and mapLoaded only catches up on one that arrived before the map could take it. tileUrl is read at refresh time and must not trigger a refresh of its own.
  useEffect(() => {
    const source = mapLoaded
      ? map.current?.getSource<maplibregl.VectorTileSource>(sourceId)
      : undefined;
    if (!source || appliedRef.current === signal) return;
    appliedRef.current = signal;

    // The `v` must not repeat across page loads (a plain counter would) nor within
    // one (two refreshes in one millisecond would collapse into one).
    cacheBusterRef.current = Math.max(Date.now(), cacheBusterRef.current + 1);
    source.setTiles([tileUrl(cacheBusterRef.current)]);
  }, [signal, mapLoaded]);
}
