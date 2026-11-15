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
 * **Null means draw no routes**, until the first answer: drawn uncoloured, the
 * routes would pass for a map with nothing ridden. A failure is retried
 * (`ridesRetryDelayMs`) until one answers or the version moves on, and the map
 * keeps what it had meanwhile. A refused token is the API client's to handle,
 * and it ends the session.
 */
import { indexRides, type RouteRides, ridesRetryDelayMs, sameRides } from "@shared/map/routeRides";
import { useEffect, useState } from "react";
import * as api from "@/api/endpoints";
import { useLogVersion } from "@/logbook/logVersion";

export function useRides(): RouteRides | null {
  const logVersion = useLogVersion();
  const [rides, setRides] = useState<RouteRides | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: logVersion is an intentional trigger — bumping it is what re-reads the rides after a journey is logged or a new session starts.
  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;

    const load = (attempt: number) => {
      api
        .rides(controller.signal)
        .then((loaded) => {
          const next = indexRides(loaded);
          setRides((current) => (sameRides(current, next) ? current : next));
        })
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
  }, [logVersion]);

  return rides;
}
