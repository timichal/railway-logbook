import { requireIdParam, requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { requireSessionUser, sessionJson } from "@/lib/api/webSession";
import { tripWithBoundsForUser } from "@/lib/tripQueries";

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/me/trips/:id?region= — an opened trip: its journeys, the routes the
 * map highlights, the stretches of those ridden in part, and the bounds of those
 * in `region` (see tripWithBoundsForUser). A route handler for the reason
 * `api/me/progress` gives.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireSessionUser();
    const region = requireRegion(new URL(request.url));
    const { id } = await context.params;

    return sessionJson(await tripWithBoundsForUser(user.id, requireIdParam(id, "trip id"), region));
  });
}
