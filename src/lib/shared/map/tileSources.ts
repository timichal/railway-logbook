import type { VectorSourceSpecification } from "@maplibre/maplibre-gl-style-spec";
import { ZOOM_RANGES } from "./zoomRanges";

/**
 * The tile sources, as MapLibre source specifications — Martin's, plus the
 * per-user route tile and the admin notes tile, which the app serves itself.
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
interface RouteTileHosts {
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
  const params: [string, string][] = [];
  if (rides && rides !== "session") params.push(["share", rides.shareToken]);
  params.push(...cacheBusterParam(cacheBuster));
  if (selectedCountries !== undefined) {
    params.push(["selected_countries", JSON.stringify(selectedCountries)]);
  }
  return rides
    ? tileUrl(`${hosts.appOrigin}/api/tiles`, "railway_routes", params)
    : tileUrl(hosts.tileBaseUrl, "railway_routes_tile", params);
}

export const createRailwayRoutesSource = (
  hosts: RouteTileHosts,
  options: RailwayRoutesSourceOptions = {},
): VectorSourceSpecification =>
  vectorSource(railwayRoutesTileUrl(hosts, options), ZOOM_RANGES.railwayRoutes);

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
 * Every admin note, drafts included — so, like a ride-coloured route tile, it is
 * served by the app's own handler (`src/app/api/tiles/admin_notes`), which checks
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
