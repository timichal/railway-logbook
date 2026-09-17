import type { VectorSourceSpecification } from "@maplibre/maplibre-gl-style-spec";

/**
 * Martin's tile sources, as MapLibre source specifications.
 *
 * **Every factory here takes the tile server's base URL rather than reading it
 * from the environment**, and that is the whole reason this module is separate
 * from `index.ts`. The web app derives its base URL from `window.location`; the
 * native app has no `window` and carries it as a build-time constant
 * (`mobile/src/config.ts`). Both need the *same* URL templates and the same
 * query-string contract — `selected_countries` is JSON-encoded, which is exactly
 * the kind of detail that drifts if it is written twice — so the templates live
 * here and the callers bring their own host.
 *
 * `index.ts` re-exports these with the web app's base URL already bound, so no
 * web call site passes it. Nothing in this module may import anything that
 * reaches the DOM: the native app imports it directly (see `@shared/*` in
 * `mobile/tsconfig.json`).
 */

/** Zoom ranges, matching Martin's configuration. */
export const ZOOM_RANGES = {
  railwayRoutes: { min: 4, max: 18 },
  railwayParts: { min: 4, max: 18 },
  stations: { min: 9, max: 18 },
  adminNotes: { min: 4, max: 18 }, // Admin notes visible at all zooms
  publicNotes: { min: 7, max: 18 }, // Public Usage notes on the user map (from moderate zoom)
} as const;

export interface RailwayRoutesSourceOptions {
  userId?: number;
  cacheBuster?: number;
  selectedCountries?: string[];
}

/**
 * Query parameters as a string, built without `URLSearchParams` — Hermes has it,
 * but `URL` and its friends are partially polyfilled in React Native and the
 * three values here are ours, not user input.
 */
function queryString(params: [string, string][]): string {
  if (params.length === 0) return "";
  return `?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
}

export function railwayRoutesTileUrl(
  tileBaseUrl: string,
  { userId, cacheBuster, selectedCountries }: RailwayRoutesSourceOptions = {},
): string {
  const params: [string, string][] = [];
  if (userId !== undefined) params.push(["user_id", userId.toString()]);
  if (cacheBuster !== undefined) params.push(["v", cacheBuster.toString()]);
  if (selectedCountries !== undefined) {
    params.push(["selected_countries", JSON.stringify(selectedCountries)]);
  }
  return `${tileBaseUrl}/railway_routes_tile/{z}/{x}/{y}${queryString(params)}`;
}

export function createRailwayRoutesSource(
  tileBaseUrl: string,
  options: RailwayRoutesSourceOptions = {},
): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [railwayRoutesTileUrl(tileBaseUrl, options)],
    minzoom: ZOOM_RANGES.railwayRoutes.min,
    maxzoom: ZOOM_RANGES.railwayRoutes.max,
  };
}

export function stationsTileUrl(tileBaseUrl: string): string {
  return `${tileBaseUrl}/stations_tile/{z}/{x}/{y}`;
}

export function createStationsSource(tileBaseUrl: string): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [stationsTileUrl(tileBaseUrl)],
    minzoom: ZOOM_RANGES.stations.min,
    maxzoom: ZOOM_RANGES.stations.max,
  };
}

/**
 * Stations for the user map: only those within 250m of a railway part.
 * Serves the same "stations" MVT layer name as `createStationsSource`, so
 * `createStationsLayer` works with either source.
 */
export function publicStationsTileUrl(tileBaseUrl: string): string {
  return `${tileBaseUrl}/public_stations_tile/{z}/{x}/{y}`;
}

export function createPublicStationsSource(tileBaseUrl: string): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [publicStationsTileUrl(tileBaseUrl)],
    minzoom: ZOOM_RANGES.stations.min,
    maxzoom: ZOOM_RANGES.stations.max,
  };
}

export function createRailwayPartsSource(tileBaseUrl: string): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [`${tileBaseUrl}/railway_parts_tile/{z}/{x}/{y}`],
    minzoom: ZOOM_RANGES.railwayParts.min,
    maxzoom: ZOOM_RANGES.railwayParts.max,
  };
}

export function createAdminNotesSource(
  tileBaseUrl: string,
  cacheBuster?: number,
): VectorSourceSpecification {
  const params: [string, string][] =
    cacheBuster === undefined ? [] : [["v", cacheBuster.toString()]];
  return {
    type: "vector",
    tiles: [`${tileBaseUrl}/admin_notes_tile/{z}/{x}/{y}${queryString(params)}`],
    minzoom: ZOOM_RANGES.adminNotes.min,
    maxzoom: ZOOM_RANGES.adminNotes.max,
  };
}

/**
 * Public notes source (note_type='Usage' only) for the user map.
 * Served by the `public_notes_tile` function, which exposes only published
 * Usage notes and only the popup fields (text + source).
 */
export function publicNotesTileUrl(tileBaseUrl: string, cacheBuster?: number): string {
  const params: [string, string][] =
    cacheBuster === undefined ? [] : [["v", cacheBuster.toString()]];
  return `${tileBaseUrl}/public_notes_tile/{z}/{x}/{y}${queryString(params)}`;
}

export function createPublicNotesSource(
  tileBaseUrl: string,
  cacheBuster?: number,
): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [publicNotesTileUrl(tileBaseUrl, cacheBuster)],
    minzoom: ZOOM_RANGES.publicNotes.min,
    maxzoom: ZOOM_RANGES.publicNotes.max,
  };
}
