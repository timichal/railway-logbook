import { requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { requireSessionUser, sessionJson } from "@/lib/api/webSession";
import { routeRidesForUser } from "@/lib/progressQueries";

/**
 * GET /api/me/rides?region= — every route the signed-in web user has ridden in
 * `region`, for the map's colours (`RouteRide`). The route tile is the same for
 * everyone, so this is what says whose map it is. A route handler for the reason
 * `api/me/progress` gives; a missing session is a 401, and the map then draws no
 * routes rather than all of them unridden.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireSessionUser();
    const region = requireRegion(new URL(request.url));

    return sessionJson(await routeRidesForUser(user.id, region));
  });
}
