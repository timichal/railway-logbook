import { requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { searchStationsByName } from "@/lib/routeQueries";

/**
 * GET /api/v1/stations?q=&region= — station-name autocomplete.
 *
 * Public, like the tiles it matches: only `near_route` stations of the named
 * region, at most 10. Fewer than two characters returns nothing rather than the
 * world.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const url = new URL(request.url);
    const region = requireRegion(url);
    const searchQuery = url.searchParams.get("q") ?? "";

    return jsonResponse({ stations: await searchStationsByName(searchQuery, region) });
  });
}
