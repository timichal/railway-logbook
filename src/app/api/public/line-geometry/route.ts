import { requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { lineGeometryByName } from "@/lib/routeQueries";

/**
 * GET /api/public/line-geometry?name=&region= — a line picked in the map search
 * box, as the geometry its highlight is drawn from. Public, for the reason
 * `api/public/stations` gives.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const url = new URL(request.url);
    const region = requireRegion(url);

    return jsonResponse(await lineGeometryByName(url.searchParams.get("name") ?? "", region));
  });
}
