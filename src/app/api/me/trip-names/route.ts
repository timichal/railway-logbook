import { requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { requireSessionUser, sessionJson } from "@/lib/api/webSession";
import { tripNamesForUser } from "@/lib/tripQueries";

/**
 * GET /api/me/trip-names?region= — the signed-in web user's trips in `region`, as
 * the journey forms' trip picker offers them. A route handler for the reason
 * `api/me/progress` gives.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireSessionUser();
    const region = requireRegion(new URL(request.url));

    return sessionJson(await tripNamesForUser(user.id, region));
  });
}
