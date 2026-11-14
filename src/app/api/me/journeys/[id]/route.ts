import { requireIdParam, requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { requireSessionUser, sessionJson } from "@/lib/api/webSession";
import { journeyWithBoundsForUser } from "@/lib/journeyQueries";

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/me/journeys/:id?region= — an opened journey: its logged routes, the
 * bounds of those in `region` and the stretches of those ridden in part (see
 * journeyWithBoundsForUser). A 404 when it is gone, which drops its draft. A
 * route handler for the reason `api/me/progress` gives.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireSessionUser();
    const region = requireRegion(new URL(request.url));
    const { id } = await context.params;

    return sessionJson(
      await journeyWithBoundsForUser(user.id, requireIdParam(id, "journey id"), region),
    );
  });
}
