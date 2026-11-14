import { optionalCountries, optionalIntList, requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { requireSessionUser, sessionJson } from "@/lib/api/webSession";
import { progressForUser } from "@/lib/progressQueries";

/**
 * GET /api/me/progress?region=&countries=&usage= — the signed-in web user's km
 * and route counts, for the map's progress box.
 *
 * The web session's reads are route handlers, not server actions, because Next
 * runs a client's actions one at a time: as actions, the page's loads queued
 * behind each other and behind any slow action (the Journey Planner's search).
 * Writes stay actions. `countries` and `usage` keep their three states (absent:
 * no filter; empty: nothing), as `progressForUser` reads them.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireSessionUser();
    const url = new URL(request.url);
    const region = requireRegion(url);

    return sessionJson(
      await progressForUser(user.id, region, optionalCountries(url), optionalIntList(url, "usage")),
    );
  });
}
