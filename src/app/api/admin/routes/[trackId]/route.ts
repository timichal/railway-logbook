import { adminRoute } from "@/lib/adminRouteQueries";
import { requireIdParam } from "@/lib/api/params";
import { adminRead } from "@/lib/api/webSession";

type Context = { params: Promise<{ trackId: string }> };

/**
 * GET /api/admin/routes/:trackId — one route as the admin edits it, a 404 when
 * it is gone. A route handler for the reason `api/admin/routes` gives.
 */
export function GET(_request: Request, context: Context): Promise<Response> {
  return adminRead(async () => {
    const { trackId } = await context.params;
    return adminRoute(requireIdParam(trackId, "track id"));
  });
}
