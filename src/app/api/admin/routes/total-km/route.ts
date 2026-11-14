import { validRoutesTotalKm } from "@/lib/adminRouteQueries";
import { requireRegion } from "@/lib/api/params";
import { adminRead } from "@/lib/api/webSession";

/**
 * GET /api/admin/routes/total-km?region= — the km of the region's valid, open
 * routes, for the admin map's counter. A route handler for the reason
 * `api/admin/routes` gives.
 */
export function GET(request: Request): Promise<Response> {
  return adminRead(() => validRoutesTotalKm(requireRegion(new URL(request.url))));
}
