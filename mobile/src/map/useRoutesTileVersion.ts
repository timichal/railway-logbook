/**
 * The version the route tile URL carries (`GET /api/v1/routes/tile-version`), which
 * puts the map on Martin's cached source: `railway_routes_tile_versioned`, served
 * `immutable`, so MapLibre Native's ambient cache keeps its tiles across launches and
 * Martin answers them from memory. The version moves with every change to the tile,
 * and a new one is a new URL, so nothing held under the old one is drawn again.
 *
 * **The last version heard is kept on the device** and drawn under at once on the
 * next launch: its tiles are the ones the ambient cache holds, so the map draws
 * straight from the disk, offline included. The server is asked alongside, and a
 * newer answer moves the map on. Only a first launch has nothing to start from.
 *
 * - **`null`**: nothing to draw under yet (the device copy is being read, or a first
 *   launch is asking). The map mounts no route source meanwhile, rather than start on
 *   the uncached URL and fetch every tile twice. Bounded by `REQUEST_TIMEOUT_MS`.
 * - **`undefined`**: no version, from the server or the device. The map draws the
 *   uncached tile (`railway_routes_tile`, always current) until a read answers.
 * - **a string**: the version.
 *
 * A failed read is retried (`ridesRetryDelayMs`) until one answers, whatever is held:
 * a held version may be the one the server has just moved on from. Read again on a
 * return to the foreground after `STALE_AFTER_MS` away, as the rides are.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ridesRetryDelayMs } from "@shared/map/routeRides";
import { useEffect, useState } from "react";
import * as api from "@/api/endpoints";
import { useOnForeground } from "@/lifecycle/useOnForeground";

const STORAGE_KEY = "railwayLogbook.routesTileVersion";

/**
 * How long a read may take before it counts as failed. A stalled connection (a
 * train between cells) neither answers nor fails, and with nothing on the device
 * the route source waits for this.
 */
const REQUEST_TIMEOUT_MS = 5_000;

/** Away at least this long, and the version is read again on return. */
const STALE_AFTER_MS = 60 * 1000;

/** A version held stays; otherwise `fallback` (the device's copy, or the uncached tile). */
function unlessHeld(fallback: string | undefined) {
  return (held: string | null | undefined) => (typeof held === "string" ? held : fallback);
}

export function useRoutesTileVersion(): string | null | undefined {
  const [version, setVersion] = useState<string | null | undefined>(null);
  // Bumped by a return to the foreground: the effect below reads it again
  const [check, setCheck] = useState(0);

  useOnForeground((awayMs) => {
    if (awayMs >= STALE_AFTER_MS) setCheck((n) => n + 1);
  });

  // The device's copy, unless the server has answered first
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .catch(() => null)
      .then((stored) => {
        // None stored: the server's answer (or its failure) decides
        if (!cancelled && stored) setVersion(unlessHeld(stored));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: check is an intentional trigger — a return to the foreground reads the version again.
  useEffect(() => {
    let stopped = false;
    let controller: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const load = (attempt: number) => {
      const own = new AbortController();
      controller = own;
      timeout = setTimeout(() => own.abort(), REQUEST_TIMEOUT_MS);
      api
        .routesTileVersion(own.signal)
        .then((current) => {
          if (stopped) return;
          setVersion(current);
          void AsyncStorage.setItem(STORAGE_KEY, current).catch(() => {
            // The next launch asks the server first instead
          });
        })
        .catch((error: unknown) => {
          if (stopped) return;
          console.warn("Route tile version failed:", error);
          // Nothing held: the uncached tile until a read answers
          setVersion(unlessHeld(undefined));
          retry = setTimeout(() => load(attempt + 1), ridesRetryDelayMs(attempt));
        })
        .finally(() => clearTimeout(timeout));
    };
    load(0);

    return () => {
      stopped = true;
      controller?.abort();
      clearTimeout(timeout);
      clearTimeout(retry);
    };
  }, [check]);

  return version;
}
