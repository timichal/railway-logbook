import type * as MapLibre from "maplibre-gl";

type MapLibreModule = typeof MapLibre;

/**
 * MapLibre (~1.1MB) is loaded on its own, not as part of the map component's chunk,
 * so the sidebar and the rest of the page render without waiting for it. Everything
 * else imports `maplibre-gl` for its types only (`import type`).
 *
 * `loadMapLibre` is started from the main bundle with the basemap style
 * (`usePrefetchMap`), so the download overlaps the map component's own chunk, and
 * `useMapLibre` awaits it before building a map. A failed load is forgotten, so the
 * next map build asks again.
 */
let loading: Promise<MapLibreModule> | null = null;
let loaded: MapLibreModule | null = null;

export function loadMapLibre(): Promise<MapLibreModule> {
  loading ??= import("maplibre-gl").then(
    (module) => {
      // v6 ships ESM-only. Its worker does a relative import of maplibre-gl-shared.mjs
      // at runtime; Next.js emits a `new URL(...)` worker as a bare asset without that
      // sibling, so it 404s. Instead we serve both files from public/maplibre/ (copied
      // by the copyMaplibreWorker script) where the relative import resolves.
      module.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      loaded = module;
      return module;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/**
 * The loaded module, for code that only runs once a map exists (popups opened from
 * map events). A map is built only after `loadMapLibre` resolved, so it is there.
 */
export function mapLibre(): MapLibreModule {
  if (!loaded) throw new Error("MapLibre is used before any map was built");
  return loaded;
}
