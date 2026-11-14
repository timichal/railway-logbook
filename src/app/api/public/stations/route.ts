import { requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { searchStationsByName } from "@/lib/routeQueries";

/**
 * GET /api/public/stations?q=&region= — the station picker's search (the Journey
 * Planner's fields): near-route stations only.
 *
 * The web page's public reads are route handlers, not server actions, because
 * Next runs a client's actions one at a time: as actions, a search typed while
 * the planner searched waited for the planner. They need no session and must
 * never read one; every handler under `api/public` answers the same to anyone.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const url = new URL(request.url);
    const region = requireRegion(url);

    return jsonResponse(await searchStationsByName(url.searchParams.get("q") ?? "", region));
  });
}
