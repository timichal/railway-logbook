/**
 * The tile URLs, with this build's hosts bound in.
 *
 * The templates and the query-string contract are the web app's
 * (`@shared/map/tileSources`), which takes the hosts as arguments for exactly this
 * reason; all that is left here is to supply them. `TILE_BASE_URL` and `API_ORIGIN`
 * are build-time constants rather than something derived from a `window` (see
 * `src/config.ts`).
 *
 * The route tile is the one that is not Martin's: coloured by the user's rides, it
 * is served by the app itself and needs the bearer token, which `tileAuth.ts`
 * attaches to exactly the requests `ROUTE_TILE_PATH` prefixes.
 *
 * Sources are declared as `<VectorSource tiles minzoom maxzoom>` in JSX rather than
 * as source specifications, so these are the URL builders and not the
 * `create*Source` factories beside them.
 */
import {
  publicNotesTileUrl,
  publicStationsTileUrl,
  type RailwayRoutesSourceOptions,
  railwayRoutesTileUrl,
} from "@shared/map/tileSources";
import { ZOOM_RANGES } from "@shared/map/zoomRanges";
import { API_ORIGIN, TILE_BASE_URL } from "@/config";

export { ZOOM_RANGES };

/** Everything under here is the route tile coloured by someone's rides. */
export const ROUTE_TILE_PATH = `${API_ORIGIN}/api/tiles/`;

/**
 * The route tile, coloured by the signed-in user's rides — whose, the server reads
 * off the bearer token (`tileAuth.ts`), never off the URL.
 */
export function routesTileUrl(options: Omit<RailwayRoutesSourceOptions, "rides">): string {
  return railwayRoutesTileUrl(
    { tileBaseUrl: TILE_BASE_URL, appOrigin: API_ORIGIN },
    { ...options, rides: "session" },
  );
}

/** `near_route` stations only — the same tile the web user map draws. */
export function stationsTileUrl(): string {
  return publicStationsTileUrl(TILE_BASE_URL);
}

/** Published `Usage` notes only. */
export function notesTileUrl(): string {
  return publicNotesTileUrl(TILE_BASE_URL);
}
