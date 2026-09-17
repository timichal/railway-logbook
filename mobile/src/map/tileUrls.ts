/**
 * Martin's tile URLs, with this build's tile host bound in.
 *
 * The templates and the query-string contract are the web app's
 * (`@shared/map/tileSources`), which takes the host as an argument for exactly this
 * reason; all that is left here is to supply it. `TILE_BASE_URL` is a build-time
 * constant rather than something derived from a `window` (see `src/config.ts`).
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
  ZOOM_RANGES,
} from "@shared/map/tileSources";
import { TILE_BASE_URL } from "@/config";

export { ZOOM_RANGES };

export function routesTileUrl(options: RailwayRoutesSourceOptions): string {
  return railwayRoutesTileUrl(TILE_BASE_URL, options);
}

/** `near_route` stations only — the same tile the web user map draws. */
export function stationsTileUrl(): string {
  return publicStationsTileUrl(TILE_BASE_URL);
}

/** Published `Usage` notes only. */
export function notesTileUrl(): string {
  return publicNotesTileUrl(TILE_BASE_URL);
}
