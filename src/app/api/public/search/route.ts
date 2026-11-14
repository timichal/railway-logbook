import { requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { searchMapByName } from "@/lib/routeQueries";

/**
 * GET /api/public/search?q=&region= — the map search box: near-route stations,
 * and lines where the region names them. Public, for the reason
 * `api/public/stations` gives.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const url = new URL(request.url);
    const region = requireRegion(url);

    return jsonResponse(await searchMapByName(url.searchParams.get("q") ?? "", region));
  });
}
