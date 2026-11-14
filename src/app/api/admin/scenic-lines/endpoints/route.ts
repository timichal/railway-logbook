import { scenicLineEndpoints } from "@/lib/adminScenicLineQueries";
import { requireRegion } from "@/lib/api/params";
import { adminRead } from "@/lib/api/webSession";

/**
 * GET /api/admin/scenic-lines/endpoints?region= — the region's scenic line
 * endpoints, for the admin map's dots in scenic mode. A route handler for the
 * reason `api/admin/routes` gives.
 */
export function GET(request: Request): Promise<Response> {
  return adminRead(() => scenicLineEndpoints(requireRegion(new URL(request.url))));
}
