import type * as maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef } from "react";
import type { DataAccess, LocalRouteStatus } from "@/lib/dataAccess";
import { getTodayDateStr } from "@/lib/shared/getUntimezonedDateStr";

const ROUTE_FEATURE = { source: "railway_routes", sourceLayer: "railway_routes" } as const;

/** A failed load is tried once more after this long before it is reported. */
const RETRY_DELAY_MS = 5000;

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
 * Whether there is a local log to colour from is the data access's to say, not a
 * separate flag's: a login swaps the data access, and the states applied through
 * the old one are cleared at once, in the effect's cleanup — not after the new one
 * has answered, by which time the logged-in tiles would already have been painted
 * with the visitor's rides. Only the localStorage implementation then puts any
 * back. A flag passed beside the data access could disagree with it.
 *
 * Returns the refresh to call after the local log changes. It never rejects: a
 * failed load is retried once, then logged and reported, and the map stays
 * uncoloured until the next refresh (a logged journey, a region switch).
 */
export function useLocalRouteFeatureStates(
  map: React.MutableRefObject<maplibregl.Map | null>,
  mapLoaded: boolean,
  dataAccess: DataAccess,
  onError: (message: string) => void,
): () => Promise<void> {
  // Which routes have feature states applied, so the ones no longer ridden can be
  // cleared
  const trackIdsRef = useRef<Set<number>>(new Set());

  // Only the latest refresh may write. After a region switch the old region's
  // statuses can arrive last (Europe's route list is far slower to load than
  // Japan's), and they judge "ridden whole" against the old region's routes; after
  // a login, the visitor's statuses would stay on the logged-in map.
  const requestRef = useRef(0);

  // Not a dep of the refresh: a new callback identity must not re-colour the map.
  // A ref rather than an Effect Event, because the refresh is also called from an
  // event handler (a journey just logged), which an Effect Event may not be.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!map.current) return;

    // The local data access forgets a failed route list, so a second attempt
    // fetches afresh. Nothing else would ask again for a while: an anonymous
    // visitor's map only refreshes when a journey is logged.
    let statuses: LocalRouteStatus[] | null = null;
    for (let attempt = 0; statuses === null; attempt++) {
      try {
        statuses = await dataAccess.getLocalRouteStatuses();
      } catch (error) {
        console.error("Error loading local route statuses:", error);
        if (requestId !== requestRef.current) return;
        if (attempt > 0) {
          onErrorRef.current("Couldn't load the routes to colour your rides on the map");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        if (requestId !== requestRef.current) return;
      }
    }
    // Re-read after the await: the map may have gone away while it ran, or a newer
    // refresh (another region, a login) superseded this one
    const target = map.current;
    if (!target || requestId !== requestRef.current) return;

    const date = getTodayDateStr();
    const newTrackIds = new Set<number>();
    for (const status of statuses) {
      newTrackIds.add(status.track_id);
      target.setFeatureState(
        { ...ROUTE_FEATURE, id: status.track_id },
        { hasTrip: true, date, partial: !status.complete },
      );
    }

    for (const trackId of trackIdsRef.current) {
      if (!newTrackIds.has(trackId)) {
        target.removeFeatureState({ ...ROUTE_FEATURE, id: trackId });
      }
    }

    trackIdsRef.current = newTrackIds;
  }, [map, dataAccess]);

  useEffect(() => {
    const m = map.current;
    if (!m || !mapLoaded) return;

    const applyStates = () => {
      void refresh();
    };

    if (m.isMoving()) {
      m.once("idle", applyStates);
    } else {
      applyStates();
    }
    // Whatever this run started is out of date once it re-runs (a login, or a new
    // region's data access): drop it now rather than when the next refresh starts,
    // which may itself be waiting for "idle". The states it applied go too, straight
    // away — unless the map itself has gone, and they with it.
    return () => {
      m.off("idle", applyStates);
      requestRef.current++;
      if (map.current === m) {
        for (const trackId of trackIdsRef.current) {
          m.removeFeatureState({ ...ROUTE_FEATURE, id: trackId });
        }
      }
      trackIdsRef.current = new Set();
    };
  }, [map, mapLoaded, refresh]);

  return refresh;
}
