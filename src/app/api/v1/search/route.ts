import { requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { searchMapByName } from "@/lib/routeQueries";

/**
 * GET /api/v1/search?q=&region= — the map's search box: `near_route` stations, and
 * lines where the region names them (`hasRouteNames`), in one request per keystroke
 * as on the web (`api/public/search`). The planner's fields search stations alone
 * (`/stations`).
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const url = new URL(request.url);
    const region = requireRegion(url);

    return jsonResponse(await searchMapByName(url.searchParams.get("q") ?? "", region));
  });
}
