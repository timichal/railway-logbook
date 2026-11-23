/**
 * The signed-in user's rides (`@shared/map/routeRides`), which colour the map.
 *
 * Martin's route tile is the same for everyone and carries no rides, so they are
 * fetched once as a list (`GET /api/v1/rides`) and laid over it by feature id: the
 * colour, the draw order and the closed routes kept (`userRouteLayerConfigs`,
 * `closedRoutesFilter`). The same mechanism as the web app's, built from the same
 * shared expressions.
 *
 * Read again on the log version, which moves with every write made here, a new
 * session, and a return after a minute away (`AuthContext`). An answer that
 * changed nothing keeps the object it had, so the layers aren't rebuilt and their
 * id lists aren't sent across the bridge again.
 *
 * **The last answer is kept on the device** (`storedRides.ts`) and drawn from at
 * once on the next launch, until the server answers: with the route tiles in
 * MapLibre's disk cache under the kept tile version, an offline cold start draws
 * the map as it was last seen. The server is asked alongside, and its answer
 * replaces the copy (and the copy on the device). A device copy read after the
 * server has answered is dropped.
 *
 * **Null means draw no routes**, until the first answer from either: drawn
 * uncoloured, the routes would pass for a map with nothing ridden. A failure is
 * retried (`ridesRetryDelayMs`) until one answers or the version moves on, and the
 * map keeps what it had meanwhile. A refused token is the API client's to handle,
 * and it ends the session.
 */
import {
  indexRides,
  type RouteRide,
  type RouteRides,
  ridesRetryDelayMs,
  sameRides,
} from "@shared/map/routeRides";
import { useEffect, useRef, useState } from "react";
import * as api from "@/api/endpoints";
import { useAuth } from "@/auth/AuthContext";
import { useLogVersion } from "@/logbook/logVersion";
import { readStoredRides, ridesSession, storeRides } from "@/map/storedRides";

export function useRides(): RouteRides | null {
  const logVersion = useLogVersion();
  // The map is behind the auth guard, so there is a user. Null only in passing, as
  // a session ends: nothing is read or kept for it.
  const userId = useAuth().user?.id ?? null;
  const [rides, setRides] = useState<RouteRides | null>(null);
  // Whether the server has answered for this account; a device copy read later is older
  const heard = useRef(false);
  // What the device holds for this account, so an answer that changed nothing isn't
  // written again (every return to the foreground after a minute reads them)
  const kept = useRef<RouteRides | null>(null);

  // The device's copy, unless the server has answered first
  useEffect(() => {
    heard.current = false;
    kept.current = null;
    setRides(null);
    if (userId === null) return;
    let cancelled = false;
    void readStoredRides(userId).then((stored) => {
      if (cancelled || heard.current || !stored) return;
      const held = indexRides(stored);
      kept.current = held;
      setRides(held);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: logVersion is an intentional trigger — bumping it is what re-reads the rides after a journey is logged or a new session starts.
  useEffect(() => {
    if (userId === null) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;

    // Kept on the device only if the session is still this one when the answer lands
    const readIn = ridesSession();

    const accept = (loaded: RouteRide[]) => {
      heard.current = true;
      const next = indexRides(loaded);
      setRides((current) => (sameRides(current, next) ? current : next));
      if (!sameRides(kept.current, next)) {
        kept.current = next;
        storeRides(userId, loaded, readIn);
      }
    };

    const load = (attempt: number) => {
      api
        .rides(controller.signal)
        .then(accept)
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.warn("Rides failed:", error);
          retry = setTimeout(() => load(attempt + 1), ridesRetryDelayMs(attempt));
        });
    };
    load(0);

    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  }, [logVersion, userId]);

  return rides;
}
