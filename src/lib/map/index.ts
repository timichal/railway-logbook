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
 * `location` on it; and `mapState` below reaches localStorage. The app imports
 * `@shared/map/style`, `@shared/map/layers`, `@shared/map/tileSources` and
 * `@shared/map/basemap` directly instead — those four carry no DOM dependency, and
 * keeping it that way is what keeps one set of layer specs serving both renderers.
 */

// The basemap (vector, latin labels) and its raster fallback live in basemap.ts.
export {
  BASEMAP_FONT,
  BASEMAP_FONT_BOLD,
  BASEMAP_STYLE_URLS,
  createBasemapFadeLayer,
  createCountryBordersLayer,
  createOSMBackgroundGroundLayer,
  createOSMBackgroundLayer,
  createOSMBackgroundSource,
  dropPoiLayers,
  filterPointsFromParkOutlines,
  flattenBuildings,
  GLYPHS_URL,
  latinizeLabels,
  loadBasemapStyle,
  OSM_TILES_URL,
} from "../shared/map/basemap";
// Layer specs — shared with the native app, hence their own module.
export {
  createAdminNotesLayer,
  createPublicNotesLayer,
  createRailwayPartsLayer,
  createRailwayRoutesClickLayer,
  createRailwayRoutesHeritageLayer,
  createRailwayRoutesLayer,
  createRailwayRoutesSpecialLayer,
  createScenicRoutesOutlineLayer,
  createStationLabelsLayer,
  createStationsLayer,
  lineClassColorExpression,
  type RailwayRoutesPaintConfig,
} from "../shared/map/layers";
// Re-export so existing `import { COLORS } from '@/lib/map'` keeps working.
export { CIRCLES, COLORS, DASHES, LABELS, OPACITIES, WIDTHS } from "../shared/map/style";
export type { RailwayRoutesSourceOptions, RouteTileRides } from "../shared/map/tileSources";
export { ZOOM_RANGES } from "../shared/map/zoomRanges";
export { resolveMissingBasemapIcons } from "./missingIcons";

// ============================================================================
// TILE SOURCES, BOUND TO THIS APP'S TILE HOST
// ============================================================================

// The initial view and the panning limits are per-region; see src/lib/shared/regions.ts.
export const TILE_SERVER_PORT = 3001;

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
 * The app's own origin, for the per-user route tile served by Next. Absolute,
 * because MapLibre fetches tiles from a worker whose base URL is not the page's.
 */
const APP_ORIGIN = typeof window === "undefined" || !window.location ? "" : window.location.origin;

export const createRailwayRoutesSource = (options: sources.RailwayRoutesSourceOptions = {}) =>
  sources.createRailwayRoutesSource({ tileBaseUrl: TILE_BASE_URL, appOrigin: APP_ORIGIN }, options);

export const createStationsSource = () => sources.createStationsSource(TILE_BASE_URL);

export const createPublicStationsSource = () => sources.createPublicStationsSource(TILE_BASE_URL);

export const createRailwayPartsSource = () => sources.createRailwayPartsSource(TILE_BASE_URL);

export const createAdminNotesSource = (cacheBuster?: number) =>
  sources.createAdminNotesSource(TILE_BASE_URL, cacheBuster);

export const createPublicNotesSource = (cacheBuster?: number) =>
  sources.createPublicNotesSource(TILE_BASE_URL, cacheBuster);

// ============================================================================
// MAP STATE PERSISTENCE
// ============================================================================

export { loadMapState, type MapState, saveMapState } from "./mapState";
