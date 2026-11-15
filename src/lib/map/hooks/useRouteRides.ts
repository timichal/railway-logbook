import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionError } from "@/lib/actionResult";
import type { DataAccess } from "@/lib/dataAccess";
import {
  indexRides,
  keepWithProvisional,
  type RouteRide,
  type RouteRides,
  ridesRetryDelayMs,
  sameRides,
} from "@/lib/shared/map/routeRides";

/**
 * The rides of the map's owner (`routeRides.ts`), which colour the user map: the
 * session's, a share token's or the localStorage log's, whichever the data access
 * stands for.
 *
 * Asked for as soon as there is a data access, not once the map has loaded, so
 * they are usually here before the map is built and its first frame is coloured.
 * Until they are, the map draws what `getProvisionalRides` allows: nothing for an
 * owner on the server, every logged route uncoloured for localStorage.
 *
 * **Null means draw no routes.** An owner on the server whose rides haven't come,
 * or were refused (a session gone, a share link switched off): drawn uncoloured,
 * the routes would pass for a map with nothing ridden, and a map that quietly lies
 * about what was ridden is worse than an empty one. A refusal says nothing more:
 * the session check (`useSessionKeepAlive`) tells a signed-out user, and the
 * shared map's progress box fails beside it.
 *
 * Any other failure is retried (`ridesRetryDelayMs`) until it answers or a newer
 * request takes over, and reported once, on the second. Meanwhile the map keeps
 * what it had, and for localStorage it also lets through every route logged since
 * (`keepWithProvisional`), so a ride just logged never disappears from the map.
 *
 * Each answer is kept with the data access it was asked of: a login, a logout or
 * a region switch replaces it, and the old one's rides go at once rather than
 * when the new ones arrive (they would colour the next account's map). An answer
 * that changed nothing keeps the object it had, so nothing is restyled for it.
 *
 * Returns the refresh to call after the rides may have changed: a logged
 * journey, a return to the page. It never rejects.
 */
export function useRouteRides(
  dataAccess: DataAccess,
  onError: (message: string) => void,
): { rides: RouteRides | null; refresh: () => Promise<void> } {
  const provisional = useMemo(() => dataAccess.getProvisionalRides(), [dataAccess]);
  const [answer, setAnswer] = useState<{
    from: DataAccess;
    rides: RouteRides | null;
  } | null>(null);
  const rides = answer?.from === dataAccess ? answer.rides : provisional;

  // Only the latest request may answer. After a region switch the old region's
  // rides can arrive last (Europe's route list, which the local ones need, is far
  // slower to load than Japan's).
  const requestRef = useRef(0);

  // Not a dep of the refresh: a new callback identity must not refetch
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    const settle = (next: (earlier: RouteRides | null) => RouteRides | null) =>
      setAnswer((current) => {
        const earlier = current?.from === dataAccess ? current.rides : provisional;
        const rides = next(earlier);
        return sameRides(earlier, rides) && current?.from === dataAccess
          ? current
          : { from: dataAccess, rides };
      });

    let loaded: RouteRide[] | null = null;
    for (let attempt = 0; loaded === null; attempt++) {
      try {
        loaded = await dataAccess.getRouteRides();
      } catch (error) {
        if (request !== requestRef.current) return;
        console.error("Error loading the rides:", error);
        // Back to what may be drawn without the rides: nothing for an owner on
        // the server, the uncoloured log for localStorage (whose route list, a
        // public read, has no session to lose)
        if (error instanceof ActionError) {
          settle(() => dataAccess.getProvisionalRides());
          return;
        }
        const logged = dataAccess.getProvisionalRides();
        if (logged) settle((earlier) => keepWithProvisional(earlier, logged));
        if (attempt === 1) onErrorRef.current("Couldn't load your rides to colour the map");
        await new Promise((resolve) => setTimeout(resolve, ridesRetryDelayMs(attempt)));
        if (request !== requestRef.current) return;
      }
    }
    if (request !== requestRef.current) return;
    const answered = indexRides(loaded);
    settle(() => answered);
  }, [dataAccess, provisional]);

  useEffect(() => {
    void refresh();
    // Whatever this run asked is out of date once it re-runs
    return () => {
      requestRef.current++;
    };
  }, [refresh]);

  return { rides, refresh };
}
