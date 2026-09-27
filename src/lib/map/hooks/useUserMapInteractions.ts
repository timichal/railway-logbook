import type * as maplibregl from "maplibre-gl";
import { useEffect } from "react";
import {
  setupUserMapInteractions,
  type UserMapInteractionCallbacks,
} from "@/lib/map/interactions/userMapInteractions";

/**
 * Attaches the user map's popups, touch sheets and click handlers once the route
 * layers exist, and re-attaches them whenever a callback changes. Shared by the
 * interactive map and the read-only shared one, which differ only in the callbacks
 * they pass (the shared map passes no `onRouteClick`, which is what makes it
 * read-only).
 *
 * The callbacks are effect deps, so a caller that builds one inline re-attaches
 * every handler on every render: memoise them.
 */
export function useUserMapInteractions(
  map: React.MutableRefObject<maplibregl.Map | null>,
  mapLoaded: boolean,
  { onRouteClick, onStationClick, region, routeTapAction }: UserMapInteractionCallbacks,
) {
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    let cleanup: (() => void) | undefined;
    // A setup deferred to "idle" outlives the effect run that queued it: without
    // this, an effect re-run while the map is still moving queues a second one and
    // both fire, leaving two live sets of handlers with only the later set's
    // teardown tracked. Two sets means one tap handled twice, by two closures that
    // disagree about which popup is open.
    let cancelled = false;

    const setupWhenReady = () => {
      if (cancelled || !map.current?.getLayer("railway_routes")) return;
      cleanup = setupUserMapInteractions(map.current, {
        onRouteClick,
        onStationClick,
        region,
        routeTapAction,
      });
    };

    if (!map.current.isMoving()) {
      setupWhenReady();
    } else {
      map.current.once("idle", setupWhenReady);
    }

    return () => {
      cancelled = true;
      map.current?.off("idle", setupWhenReady);
      if (cleanup) cleanup();
    };
  }, [map, mapLoaded, onRouteClick, onStationClick, region, routeTapAction]);
}
