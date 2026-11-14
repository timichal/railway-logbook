import { useEffect } from "react";
import { loadMapLibre } from "@/lib/map/maplibre";
import { loadBasemapStyle } from "@/lib/shared/map/basemap";

/**
 * Start fetching what a map can't be built without, from the main bundle, so both
 * overlap the download of the map component's own chunk: the basemap style, and
 * MapLibre itself (~1.1MB, a chunk of its own; see maplibre.ts). `useMapLibre` asks
 * for them only once that chunk has loaded and mounted. Both loads are memoised,
 * so the map's own calls pick up these requests rather than starting others.
 *
 * The scheme is read off the class `THEME_INIT_SCRIPT` set rather than through
 * `useResolvedTheme`, which reports its server snapshot ("light") during
 * hydration and would fetch the wrong style for a dark page. A later scheme
 * change rebuilds the map, which fetches its own.
 *
 * Imports nothing from `@/lib/map/index.ts`, and MapLibre only through its dynamic
 * import: the point is to stay out of the map chunk.
 */
export function usePrefetchMap(): void {
  useEffect(() => {
    void loadBasemapStyle(document.documentElement.classList.contains("dark") ? "dark" : "light");
    // A failure is forgotten, and the map's own load asks again
    loadMapLibre().catch(() => {});
  }, []);
}
