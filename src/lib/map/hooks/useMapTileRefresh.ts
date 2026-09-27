import type * as maplibregl from "maplibre-gl";
import { useCallback, useRef, useState } from "react";
import { railwayRoutesTileUrl } from "../index";
import { useSourceTileRefresh } from "./useSourceTileRefresh";

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
 * The refresh itself is `setTiles` on the existing source (see
 * `useSourceTileRefresh`), which keeps the feature state and every overlay.
 */
export function useMapTileRefresh({
  map,
  mapLoaded,
  userId,
  selectedCountries,
}: UseMapTileRefreshOptions) {
  const [signal, setSignal] = useState(0);
  const cacheBusterRef = useRef(Date.now());

  useSourceTileRefresh({
    map,
    mapLoaded,
    sourceId: "railway_routes",
    signal,
    cacheBusterRef,
    tileUrl: (cacheBuster) =>
      railwayRoutesTileUrl({
        rides: userId ? "session" : undefined,
        cacheBuster,
        selectedCountries,
      }),
  });

  // Stable identity: consumers list it in effect/callback dependency arrays.
  const refreshTiles = useCallback(() => setSignal((previous) => previous + 1), []);

  return { refreshTiles };
}
