import type { VectorSourceSpecification } from "@maplibre/maplibre-gl-style-spec";
import { ZOOM_RANGES } from "./zoomRanges";

/**
 * The tile sources, as MapLibre source specifications — Martin's, plus the admin
 * notes tile, which the app serves itself.
 *
 * **Every factory here takes the tile server's base URL (and, for the admin notes,
 * the app's origin) rather than reading it from the environment**, and that is
 * the whole reason this module is separate from `index.ts`. The web app derives
 * its hosts from `window.location`; the native app has no `window` and carries
 * them as build-time constants (`mobile/src/config.ts`). Both need the *same* URL templates and the same
 * query-string contract — the versioned route tile is cached under its raw query
 * string, which is exactly the kind of detail that drifts if it is written twice —
 * so the templates live here and the callers bring their own hosts.
 *
 * `index.ts` re-exports these with the web app's hosts already bound, so no
 * web call site passes one. Nothing in this module may import anything that
 * reaches the DOM: the native app imports it directly (see `@shared/*` in
 * `mobile/tsconfig.json`).
 */

/**
 * The route tile comes from one of two Martin sources that run the same function.
 * Neither URL carries the ticked countries: both apps filter by country on the
 * layers (`userRoutesFilter`), so the tile is the same for everyone and Martin
 * caches one copy. `railway_routes_tile` still takes `selected_countries` for app
 * builds from before that.
 *
 * - With `version` (`routesTileVersion`: the web's server render, the app's
 *   `GET /api/v1/routes/tile-version`), it comes from
 *   `railway_routes_tile_versioned`, which is served `immutable` and kept in
 *   Martin's memory cache. Only a URL whose `v` moves with every change to the
 *   tile may go there: anything else would be held stale for a year.
 * - Without it, from `railway_routes_tile`, cached nowhere. `cacheBuster` makes
 *   MapLibre refetch tiles it already holds (the admin map, after a save).
 */
export type RailwayRoutesSourceOptions =
  | { version: string; cacheBuster?: undefined }
  | { version?: undefined; cacheBuster?: number };

/**
 * Query parameters as a string, built without `URLSearchParams` — Hermes has it,
 * but `URL` and its friends are partially polyfilled in React Native and the
 * values here are ours, not user input.
 */
function queryString(params: [string, string][]): string {
  if (params.length === 0) return "";
  return `?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
}

/** A tile URL template: `<base>/<name>/{z}/{x}/{y}` and its query string. */
function tileUrl(base: string, name: string, params: [string, string][] = []): string {
  return `${base}/${name}/{z}/{x}/{y}${queryString(params)}`;
}

/** `v=<cacheBuster>`, which makes MapLibre refetch tiles it already holds. */
function cacheBusterParam(cacheBuster?: number): [string, string][] {
  return cacheBuster === undefined ? [] : [["v", cacheBuster.toString()]];
}

function vectorSource(url: string, zooms: { min: number; max: number }): VectorSourceSpecification {
  return { type: "vector", tiles: [url], minzoom: zooms.min, maxzoom: zooms.max };
}

/**
 * The route tile's URL template: Martin's, and the same for everyone. It carries
 * no rides; each map lays its owner's over it by id (`routeRides.ts`).
 */
export function railwayRoutesTileUrl(
  tileBaseUrl: string,
  { version, cacheBuster }: RailwayRoutesSourceOptions = {},
): string {
  // Martin's cache key is the raw query string: `v` alone, nothing beside it
  const params: [string, string][] =
    version === undefined ? cacheBusterParam(cacheBuster) : [["v", version]];
  const source = version === undefined ? "railway_routes_tile" : "railway_routes_tile_versioned";
  return tileUrl(tileBaseUrl, source, params);
}

export const createRailwayRoutesSource = (
  tileBaseUrl: string,
  options: RailwayRoutesSourceOptions = {},
): VectorSourceSpecification =>
  vectorSource(railwayRoutesTileUrl(tileBaseUrl, options), ZOOM_RANGES.railwayRoutes);

/** Every station — the admin map's. */
export const createStationsSource = (tileBaseUrl: string): VectorSourceSpecification =>
  vectorSource(tileUrl(tileBaseUrl, "stations_tile"), ZOOM_RANGES.stations);

/**
 * Stations for the user map: only those within 250m of a route (`near_route`).
 * Serves the same "stations" MVT layer name as `createStationsSource`, so
 * `createStationsLayer` works with either source.
 */
export const publicStationsTileUrl = (tileBaseUrl: string): string =>
  tileUrl(tileBaseUrl, "public_stations_tile");

export const createPublicStationsSource = (tileBaseUrl: string): VectorSourceSpecification =>
  vectorSource(publicStationsTileUrl(tileBaseUrl), ZOOM_RANGES.stations);

export const createRailwayPartsSource = (tileBaseUrl: string): VectorSourceSpecification =>
  vectorSource(tileUrl(tileBaseUrl, "railway_parts_tile"), ZOOM_RANGES.railwayParts);

/**
 * Scenic lines (`scenic_lines_tile`) — public, so Martin's. Both maps draw them;
 * the admin map refreshes them after a save through `cacheBuster`.
 */
export const scenicLinesTileUrl = (tileBaseUrl: string, cacheBuster?: number): string =>
  tileUrl(tileBaseUrl, "scenic_lines_tile", cacheBusterParam(cacheBuster));

export const createScenicLinesSource = (
  tileBaseUrl: string,
  cacheBuster?: number,
): VectorSourceSpecification =>
  vectorSource(scenicLinesTileUrl(tileBaseUrl, cacheBuster), ZOOM_RANGES.scenicLines);

export const adminNotesTileUrl = (appOrigin: string, cacheBuster?: number): string =>
  tileUrl(`${appOrigin}/api/tiles`, "admin_notes", cacheBusterParam(cacheBuster));

/**
 * Every admin note, drafts included — so it is served by the app's own handler (`src/app/api/tiles/admin_notes`), which checks
 * the session for the admin, and never by Martin, which answers anyone. Takes the
 * app's origin rather than Martin's base URL for that reason.
 */
export const createAdminNotesSource = (
  appOrigin: string,
  cacheBuster?: number,
): VectorSourceSpecification =>
  vectorSource(adminNotesTileUrl(appOrigin, cacheBuster), ZOOM_RANGES.adminNotes);

/**
 * Published `Usage` notes for the user map. The `public_notes_tile` function
 * exposes only those, and only the popup fields (text + source).
 */
export const publicNotesTileUrl = (tileBaseUrl: string, cacheBuster?: number): string =>
  tileUrl(tileBaseUrl, "public_notes_tile", cacheBusterParam(cacheBuster));

export const createPublicNotesSource = (
  tileBaseUrl: string,
  cacheBuster?: number,
): VectorSourceSpecification =>
  vectorSource(publicNotesTileUrl(tileBaseUrl, cacheBuster), ZOOM_RANGES.publicNotes);
