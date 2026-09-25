/**
 * The bearer token on the route tile's requests.
 *
 * The route tile coloured by the user's rides is not Martin's — Martin answers
 * anyone, so a tile that says what someone has ridden cannot come from it. It is
 * served by the app's own handler (`src/app/api/tiles`), which reads whose rides to
 * draw off the same `Authorization: Bearer` the API takes (`API.md`, "Route tiles").
 * MapLibre makes those requests natively, outside `api/client.ts`, so the header is
 * registered with the renderer instead: once, by id, and matched to that one path so
 * the basemap and Martin's tiles are never sent a credential they have no use for.
 *
 * `tokenStore.ts` is the single writer of the token pair, so it is also the one
 * caller here — every load, refresh and sign-out moves the header with the token,
 * and a refreshed token reaches the next tile without the map being told.
 *
 * What this does not do is refresh anything. A tile answered 401 is not seen by the
 * API client, so an access token that expires while the map is open (they last 7
 * days) leaves the routes undrawn until the next API call refreshes the pair.
 */
import { TransformRequestManager } from "@maplibre/maplibre-react-native";
import { ROUTE_TILE_PATH } from "@/map/tileUrls";

const HEADER_ID = "route-tile-authorization";

/** Only the route tile; a native regex, so the origin's dots are escaped. */
const MATCH = `^${ROUTE_TILE_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;

export function setTileAuthToken(accessToken: string | null): void {
  if (accessToken) {
    TransformRequestManager.addHeader({
      id: HEADER_ID,
      match: MATCH,
      name: "Authorization",
      value: `Bearer ${accessToken}`,
    });
  } else {
    TransformRequestManager.removeHeader(HEADER_ID);
  }
}
