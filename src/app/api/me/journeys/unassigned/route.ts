import { requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { requireSessionUser, sessionJson } from "@/lib/api/webSession";
import { unassignedJourneysForUser } from "@/lib/tripQueries";

/**
 * GET /api/me/journeys/unassigned?region= — the journeys in `region` filed under
 * no trip, for a trip's assignment picker. A route handler for the reason
 * `api/me/progress` gives.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireSessionUser();
    const region = requireRegion(new URL(request.url));

    return sessionJson(await unassignedJourneysForUser(user.id, region));
  });
}
