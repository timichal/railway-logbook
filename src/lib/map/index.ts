import * as sources from "../shared/map/tileSources";

/**
 * The web app's map entry point.
 *
 * Everything here is a re-export, and the one thing this module *does* is bind the
 * web app's tile hosts to the source factories in `tileSources.ts`, which take them
 * as arguments so the native app can pass its own (see that file's header). So a web
 * call site still writes `createRailwayRoutesSource({ rides: "session" })` and never
 * mentions a URL.
 *
 * **The native app must not import this module.** `getTileBaseUrl()` runs at module
 * load and reads `window.location`, which in React Native is a `window` with no
 * `location` on it. The app imports
 * `@shared/map/style`, `@shared/map/layers`, `@shared/map/tileSources` and
 * `@shared/map/basemap` directly instead — those four carry no DOM dependency, and
 * keeping it that way is what keeps one set of layer specs serving both renderers.
 */

// Layer specs — shared with the native app, hence their own module.
export {
  createAdminNotesLayer,
  createRailwayPartsLayer,
  createRailwayRoutesClickLayer,
  createRailwayRoutesHeritageLayer,
  createRailwayRoutesLayer,
  createRailwayRoutesSpecialLayer,
  createRouteEndpointsLayer,
  createScenicRoutesOutlineLayer,
  createStationLabelsLayer,
  createStationsLayer,
  lineClassColorExpression,
} from "../shared/map/layers";
export { CIRCLES, COLORS, OPACITIES, WIDTHS } from "../shared/map/style";

// ============================================================================
// TILE SOURCES, BOUND TO THIS APP'S TILE HOST
// ============================================================================

const TILE_SERVER_PORT = 3001;

// Use /tiles/ path in production (proxied through Caddy), direct port in development
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const getTileBaseUrl = () => {
  if (typeof window === "undefined" || !window.location) {
    // Server-side rendering
    return IS_PRODUCTION ? "https://localhost/tiles" : "http://localhost:3001";
  }
  // Client-side
  return IS_PRODUCTION
    ? `${window.location.protocol}//${window.location.hostname}/tiles`
    : `${window.location.protocol}//${window.location.hostname}:${TILE_SERVER_PORT}`;
};
const TILE_BASE_URL = getTileBaseUrl();

/**
 * The app's own origin, for the tiles served by Next (the per-user route tile, the
 * admin notes). Absolute,
 * because MapLibre fetches tiles from a worker whose base URL is not the page's.
 */
const APP_ORIGIN = typeof window === "undefined" || !window.location ? "" : window.location.origin;

const ROUTE_TILE_HOSTS = { tileBaseUrl: TILE_BASE_URL, appOrigin: APP_ORIGIN };

export const createRailwayRoutesSource = (options: sources.RailwayRoutesSourceOptions = {}) =>
  sources.createRailwayRoutesSource(ROUTE_TILE_HOSTS, options);

export const railwayRoutesTileUrl = (options: sources.RailwayRoutesSourceOptions = {}) =>
  sources.railwayRoutesTileUrl(ROUTE_TILE_HOSTS, options);

export const createStationsSource = () => sources.createStationsSource(TILE_BASE_URL);

export const createPublicStationsSource = () => sources.createPublicStationsSource(TILE_BASE_URL);

export const createRailwayPartsSource = () => sources.createRailwayPartsSource(TILE_BASE_URL);

export const createAdminNotesSource = (cacheBuster?: number) =>
  sources.createAdminNotesSource(APP_ORIGIN, cacheBuster);

export const createPublicNotesSource = (cacheBuster?: number) =>
  sources.createPublicNotesSource(TILE_BASE_URL, cacheBuster);
