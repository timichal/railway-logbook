import type * as maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { railwayRoutesTileUrl } from "../index";

interface UseMapTileRefreshOptions {
  map: React.MutableRefObject<maplibregl.Map | null>;
  mapLoaded: boolean;
  /** Logged-in user ID (null for unlogged users, whose tiles carry no rides) */
  userId: number | null;
  selectedCountries: string[];
}

/**
 * Reloads the railway_routes tiles on request. Returns `refreshTiles()`.
 *
 * This is how the route source picks up a logged ride, a new user or a new country
 * filter: the map itself is built once per region (and scheme), and rebuilding it
 * for any of these would throw away the WebGL context and the basemap to change
 * one source. So the refresh reads `userId` and `selectedCountries` as they are
 * when it runs, and serves logged-out visitors too — their tile is Martin's,
 * uncoloured, and the visit states are laid on it as feature state by the caller.
 *
 * **It points the existing source at a new URL (`setTiles`) rather than replacing
 * the source.** MapLibre then reloads the tiles in view while still drawing the
 * old ones, and everything attached to the source survives: the layers and their
 * order, the highlight overlays, the layer filters, the feature state. Removing
 * and re-adding the source dropped all of that, and every overlay had to watch
 * for the refresh and put itself back.
 */
export function useMapTileRefresh({
  map,
  mapLoaded,
  userId,
  selectedCountries,
}: UseMapTileRefreshOptions) {
  // Doubles as the tile URL's `v`, so it must not repeat across page loads (a
  // plain counter would) nor within one (two refreshes in one millisecond would
  // collapse into one).
  const [cacheBuster, setCacheBuster] = useState(() => Date.now());
  // The refresh the source currently stands for. A refresh asked for while the map
  // is still loading cannot be applied yet, and the map under construction took its
  // sources from a render before it — so it is applied on load instead of dropped.
  // The initial value is what the map's own construction already stands for.
  const appliedRef = useRef(cacheBuster);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cacheBuster is the intentional trigger, and mapLoaded only catches up on one that arrived before the map could take it. userId and selectedCountries are read at refresh time but must not trigger a refresh of their own.
  useEffect(() => {
    const source = mapLoaded
      ? map.current?.getSource<maplibregl.VectorTileSource>("railway_routes")
      : undefined;
    if (!source || appliedRef.current === cacheBuster) return;
    appliedRef.current = cacheBuster;

    source.setTiles([
      railwayRoutesTileUrl({
        rides: userId ? "session" : undefined,
        cacheBuster,
        selectedCountries,
      }),
    ]);
  }, [cacheBuster, mapLoaded]);

  // Stable identity: consumers list it in effect/callback dependency arrays.
  const refreshTiles = useCallback(
    () => setCacheBuster((previous) => Math.max(Date.now(), previous + 1)),
    [],
  );

  return { refreshTiles };
}
