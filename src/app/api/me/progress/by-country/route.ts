import { requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { requireSessionUser, sessionJson } from "@/lib/api/webSession";
import { progressByCountryForUser } from "@/lib/progressQueries";

/**
 * GET /api/me/progress/by-country?region= — the signed-in web user's progress per
 * country and per counted usage type, for Map & Stats. A route handler for the
 * reason `api/me/progress` gives.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireSessionUser();
    const region = requireRegion(new URL(request.url));

    return sessionJson(await progressByCountryForUser(user.id, region));
  });
}
