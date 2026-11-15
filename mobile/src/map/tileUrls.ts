/**
 * The tile URLs, with this build's hosts bound in.
 *
 * The templates and the query-string contract are the web app's
 * (`@shared/map/tileSources`), which takes the hosts as arguments for exactly this
 * reason; all that is left here is to supply them. `TILE_BASE_URL` and `API_ORIGIN`
 * are build-time constants rather than something derived from a `window` (see
 * `src/config.ts`).
 *
 * Every one of them is Martin's and the same for everyone, the route tile
 * included: the user's rides are laid over it by id (`useRides`).
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
  scenicLinesTileUrl,
} from "@shared/map/tileSources";
import { ZOOM_RANGES } from "@shared/map/zoomRanges";
import { TILE_BASE_URL } from "@/config";

export { ZOOM_RANGES };

/** The route tile, filtered by country on the server (`selected_countries`). */
export function routesTileUrl(options: RailwayRoutesSourceOptions): string {
  return railwayRoutesTileUrl(TILE_BASE_URL, options);
}

/** `near_route` stations only — the same tile the web user map draws. */
export function stationsTileUrl(): string {
  return publicStationsTileUrl(TILE_BASE_URL);
}

/** The admin-drawn scenic stretches; filtered by country on the layer, not the URL. */
export function scenicTileUrl(): string {
  return scenicLinesTileUrl(TILE_BASE_URL);
}

/** Published `Usage` notes only. */
export function notesTileUrl(): string {
  return publicNotesTileUrl(TILE_BASE_URL);
}
