import { apiHandler, noStoreJson } from "@/lib/api/response";
import { routesTileVersion } from "@/lib/routesTileVersion";

/**
 * GET /api/public/routes-tile-version — the version the route tile URL carries
 * now (`routesTileVersion`). The pages render with it; a page checks it again on
 * load and whenever it comes back into view (`useRoutesTileVersion`), because one
 * restored from the history, or left open across a route save, holds an old one.
 * The same for everyone, but never cached: an old answer is the stale version
 * this exists to replace.
 */
export async function GET(): Promise<Response> {
  return apiHandler(async () => noStoreJson({ version: await routesTileVersion() }));
}
