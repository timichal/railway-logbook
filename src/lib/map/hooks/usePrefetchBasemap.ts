import { useEffect } from "react";
import { loadBasemapStyle } from "@/lib/shared/map/basemap";

/**
 * Start fetching the basemap style from the main bundle, so it overlaps the
 * download of the map's own chunk (MapLibre, ~1.1MB). `useMapLibre` asks for the
 * style only once that chunk has loaded and mounted, and the map can't be built
 * until the style is in. `loadBasemapStyle` is memoised per theme, so the map's
 * own call then picks up this request rather than starting another.
 *
 * The scheme is read off the class `THEME_INIT_SCRIPT` set rather than through
 * `useResolvedTheme`, which reports its server snapshot ("light") during
 * hydration and would fetch the wrong style for a dark page. A later scheme
 * change rebuilds the map, which fetches its own.
 *
 * Imports nothing from `@/lib/map/index.ts` or MapLibre: the point is to stay out
 * of the map chunk.
 */
export function usePrefetchBasemap(): void {
  useEffect(() => {
    void loadBasemapStyle(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);
}
