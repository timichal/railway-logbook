import type { VectorSourceSpecification } from "@maplibre/maplibre-gl-style-spec";
import { ZOOM_RANGES } from "./zoomRanges";

/**
 * The tile sources, as MapLibre source specifications — Martin's, plus the
 * per-user route tile the app serves itself.
 *
 * **Every factory here takes the tile server's base URL (and, for the route tile,
 * the app's origin) rather than reading it from the environment**, and that is
 * the whole reason this module is separate from `index.ts`. The web app derives
 * its hosts from `window.location`; the native app has no `window` and carries
 * them as build-time constants (`mobile/src/config.ts`). Both need the *same* URL templates and the same
 * query-string contract — `selected_countries` is JSON-encoded, which is exactly
 * the kind of detail that drifts if it is written twice — so the templates live
 * here and the callers bring their own hosts.
 *
 * `index.ts` re-exports these with the web app's hosts already bound, so no
 * web call site passes one. Nothing in this module may import anything that
 * reaches the DOM: the native app imports it directly (see `@shared/*` in
 * `mobile/tsconfig.json`).
 */

/**
 * Whose rides colour the route tile: the requester's own (`"session"` — the web
 * session cookie, or on the native app the bearer token it attaches to the
 * request), or a shared map's owner, named by its share token.
 */
export type RouteTileRides = "session" | { shareToken: string };

export interface RailwayRoutesSourceOptions {
  /** Omitted: the plain Martin tile, every route unvisited (admin, anonymous map). */
  rides?: RouteTileRides;
  cacheBuster?: number;
  selectedCountries?: string[];
}

/**
 * The two hosts a route tile can come from. Martin serves the tile with no user;
 * the tile coloured by someone's rides is the app's own route handler
 * (`src/app/api/tiles`), so it lives on the app's origin rather than under
 * Martin's `/tiles`.
 */
export interface RouteTileHosts {
  /** Martin: `/tiles` in production, port 3001 in development. */
  tileBaseUrl: string;
  /** The Next app, absolute (`https://host`). */
  appOrigin: string;
}

/**
 * Query parameters as a string, built without `URLSearchParams` — Hermes has it,
 * but `URL` and its friends are partially polyfilled in React Native and the
 * values here are ours, not user input.
 */
function queryString(params: [string, string][]): string {
  if (params.length === 0) return "";
  return `?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
}

/**
 * The route tile's URL template.
 *
 * A tile coloured by someone's rides never comes from Martin, which answers
 * anyone: it comes from our own handler, which works out whose rides to show from
 * the share token, the bearer token or the session cookie — the client never names
 * a user. On the web it is same-origin, so the cookie goes with it; the native app
 * attaches its bearer token to requests for this path (`mobile/src/map/tileAuth.ts`).
 */
export function railwayRoutesTileUrl(
  hosts: RouteTileHosts,
  { rides, cacheBuster, selectedCountries }: RailwayRoutesSourceOptions = {},
): string {
  const baseUrl = rides
    ? `${hosts.appOrigin}/api/tiles/railway_routes/{z}/{x}/{y}`
    : `${hosts.tileBaseUrl}/railway_routes_tile/{z}/{x}/{y}`;

  const params: [string, string][] = [];
  if (rides && rides !== "session") params.push(["share", rides.shareToken]);
  if (cacheBuster !== undefined) params.push(["v", cacheBuster.toString()]);
  if (selectedCountries !== undefined) {
    params.push(["selected_countries", JSON.stringify(selectedCountries)]);
  }
  return `${baseUrl}${queryString(params)}`;
}

export function createRailwayRoutesSource(
  hosts: RouteTileHosts,
  options: RailwayRoutesSourceOptions = {},
): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [railwayRoutesTileUrl(hosts, options)],
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
