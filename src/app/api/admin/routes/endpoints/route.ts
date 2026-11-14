import { routeEndpoints } from "@/lib/adminRouteQueries";
import { requireRegion } from "@/lib/api/params";
import { adminRead } from "@/lib/api/webSession";

/**
 * GET /api/admin/routes/endpoints?region= — the region's route endpoints, for
 * the admin map's dots. A route handler for the reason `api/admin/routes` gives.
 */
export function GET(request: Request): Promise<Response> {
  return adminRead(() => routeEndpoints(requireRegion(new URL(request.url))));
}
