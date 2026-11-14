import { requireRegion } from "@/lib/api/params";
import { adminRead } from "@/lib/api/webSession";
import { searchMapByName } from "@/lib/routeQueries";

/**
 * GET /api/admin/search?q=&region= — the admin map's search box. Every station,
 * not only the `near_route` ones `api/public/search` offers, since the admin map
 * draws them all; lines as on the user map. A route handler for the reason
 * `api/admin/routes` gives, which matters most here: one request per keystroke.
 */
export function GET(request: Request): Promise<Response> {
  return adminRead(() => {
    const url = new URL(request.url);
    return searchMapByName(url.searchParams.get("q") ?? "", requireRegion(url), {
      nearRouteOnly: false,
    });
  });
}
