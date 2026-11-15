import { useEffect, useState } from "react";
import { getRoutesTileVersion } from "@/lib/publicReads";

/**
 * The route tile version the user map should draw under: the one the page was
 * rendered with, until the server says it has moved.
 *
 * The rendered one can be old. Back and Forward restore a page Next rendered
 * earlier, with its version (an admin's save, then Back, would show the route as
 * it was), and a page left open keeps fetching tiles under the version it loaded
 * with. So the current one is asked for as the page mounts and whenever it comes
 * back into view (`visibilitychange`, and `pageshow` for a page out of the
 * browser's back-forward cache). A change refreshes the route source in place
 * (`useSourceTileRefresh` in `useUserMap`). A failed check keeps the version held,
 * and the next one asks again. A newer render's version (`router.refresh`) is
 * taken as it arrives.
 */
export function useRoutesTileVersion(rendered: string): string {
  const [version, setVersion] = useState(rendered);

  useEffect(() => {
    setVersion(rendered);
  }, [rendered]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const check = () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      getRoutesTileVersion()
        .then((current) => {
          if (!cancelled) setVersion(current);
        })
        .catch(() => {
          // Keep the version held: its tiles are still right for this page
        })
        .finally(() => {
          inFlight = false;
        });
    };
    // Only a restored page: the first load's pageshow follows the check above
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) check();
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", restored);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("pageshow", restored);
    };
  }, []);

  return version;
}
