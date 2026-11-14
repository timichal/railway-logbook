import { requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { requireSessionUser, sessionJson } from "@/lib/api/webSession";
import { coveredStretchesForUser } from "@/lib/progressQueries";

/**
 * GET /api/me/coverage?region= — the stretches the signed-in web user has ridden
 * on routes in `region` they haven't completed, for the map's coverage overlay.
 * A route handler for the reason `api/me/progress` gives.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireSessionUser();
    const region = requireRegion(new URL(request.url));

    return sessionJson(await coveredStretchesForUser(user.id, region));
  });
}
