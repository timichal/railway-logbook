import { requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { lineGeometryByName } from "@/lib/routeQueries";

/**
 * GET /api/v1/lines/geometry?name=&region= — a line picked in the map's search box,
 * as the geometry its highlight band is drawn from (`lineGeometryByName`), as on the
 * web (`api/public/line-geometry`). An unknown name is no lines, not a 404.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const url = new URL(request.url);
    const region = requireRegion(url);

    return jsonResponse({
      lines: await lineGeometryByName(url.searchParams.get("name") ?? "", region),
    });
  });
}
