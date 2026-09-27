import type * as maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef } from "react";
import type { DataAccess } from "@/lib/dataAccess";

const ROUTE_FEATURE = { source: "railway_routes", sourceLayer: "railway_routes" } as const;

/**
 * Colours the routes an anonymous visitor has ridden, from their localStorage log.
 *
 * The tiles carry no visit status for an unauthenticated visitor, so which routes
 * read as ridden (and which as ridden whole) is worked out from the local log (see
 * `getLocalRouteStatuses`) and applied per feature. The states live on the route
 * source, which a tile refresh keeps, so they outlast it — and would outlast a
 * login too, which is why logging in clears them: the logged-in tile leaves a route
 * it has no ride for to the feature-state branch of the colour, and the local log
 * would paint it ridden.
 *
 * Returns the refresh to call after the local log changes.
 */
export function useLocalRouteFeatureStates(
  map: React.MutableRefObject<maplibregl.Map | null>,
  mapLoaded: boolean,
  loggedIn: boolean,
  dataAccess: DataAccess,
): () => Promise<void> {
  // Which routes have feature states applied, so the ones no longer ridden can be
  // cleared
  const trackIdsRef = useRef<Set<number>>(new Set());
  // Read after an await, where the closure's `loggedIn` may already be stale.
  // Written in an effect, not during render: a render React throws away would
  // otherwise leave a value here that was never committed.
  const loggedInRef = useRef(loggedIn);
  useEffect(() => {
    loggedInRef.current = loggedIn;
  }, [loggedIn]);

  // Only the latest refresh may write. After a region switch the old region's
  // statuses can arrive last (Europe's route list is far slower to load than
  // Japan's), and they judge "ridden whole" against the old region's routes.
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!map.current || loggedIn) return;

    const statuses = await dataAccess.getLocalRouteStatuses();
    // Re-read after the await: the map may have gone away while it ran, or the
    // visitor logged in — and states laid on now would stay on the logged-in map
    const target = map.current;
    if (!target || loggedInRef.current || requestId !== requestRef.current) return;

    const newTrackIds = new Set<number>();
    for (const status of statuses) {
      newTrackIds.add(status.track_id);
      target.setFeatureState(
        { ...ROUTE_FEATURE, id: status.track_id },
        {
          hasTrip: true,
          date: new Date().toISOString().split("T")[0],
          partial: !status.complete,
        },
      );
    }

    for (const trackId of trackIdsRef.current) {
      if (!newTrackIds.has(trackId)) {
        target.removeFeatureState({ ...ROUTE_FEATURE, id: trackId });
      }
    }

    trackIdsRef.current = newTrackIds;
  }, [map, loggedIn, dataAccess]);

  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded) return;

    if (loggedIn) {
      for (const trackId of trackIdsRef.current) {
        m.removeFeatureState({ ...ROUTE_FEATURE, id: trackId });
      }
      trackIdsRef.current = new Set();
      return;
    }

    const applyStates = () => {
      refresh();
    };

    if (m.isMoving()) {
      m.once("idle", applyStates);
    } else {
      applyStates();
    }
    // Whatever this run started is out of date once it re-runs (a login, or a new
    // region's data access): drop it now rather than when the next refresh starts,
    // which may itself be waiting for "idle"
    return () => {
      m.off("idle", applyStates);
      requestRef.current++;
    };
  }, [map, mapLoaded, loggedIn, refresh]);

  return refresh;
}
