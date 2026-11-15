import { requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { routesCachedJson } from "@/lib/api/routesCache";
import { routeDetailsJson } from "@/lib/routeQueries";

/**
 * GET /api/route-details?region=<id> — every route's `RouteDetails` in a region:
 * the text the web map's popups and clicks need, which the route tile no longer
 * carries (see railway_routes_tile).
 *
 * Public and the same for everyone, so it takes no session and must never take
 * one. Kept in memory per `routesFingerprint` and revalidated by the browser on
 * every load (`routesCachedJson`): a 304 costs the fingerprint (one primary-key read), not the
 * query (~300ms). An admin's save is seen on the next load, or at once by a
 * client that asks again (`loadRouteDetails`).
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const region = requireRegion(new URL(request.url));
    return routesCachedJson(request, `route-details/${region}`, () => routeDetailsJson(region));
  });
}
