import { apiHandler, noStoreJson } from "@/lib/api/response";
import { routesTileVersion } from "@/lib/routesTileVersion";

/**
 * GET /api/v1/routes/tile-version — the version the route tile URL carries now
 * (`routesTileVersion`), for the app's `railway_routes_tile_versioned` source.
 * The web pages read the same through `GET /api/public/routes-tile-version`.
 *
 * No token: it is the same for everyone. Never cached either: an old answer is
 * the stale version this exists to replace, and a tile fetched under it would be
 * held for a year.
 */
export async function GET(): Promise<Response> {
  return apiHandler(async () => noStoreJson({ version: await routesTileVersion() }));
}
