import { partialRideCount } from "@/lib/adminRouteQueries";
import { requireIdParam } from "@/lib/api/params";
import { adminRead } from "@/lib/api/webSession";

type Context = { params: Promise<{ trackId: string }> };

/**
 * GET /api/admin/routes/:trackId/partial-rides — how many partial rides users have
 * logged on the route, read as a geometry re-pick starts, for its warning. A route
 * handler for the reason `api/admin/routes` gives.
 */
export function GET(_request: Request, context: Context): Promise<Response> {
  return adminRead(async () => {
    const { trackId } = await context.params;
    return partialRideCount(requireIdParam(trackId, "track id"));
  });
}
