import { requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { trackIdsInRegion } from "@/lib/routeQueries";

/**
 * GET /api/public/track-ids?region= — the ids of every route in a region, which
 * tell the local journey list which of its journeys belong to the region on
 * screen. Public, for the reason `api/public/stations` gives.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const region = requireRegion(new URL(request.url));

    return jsonResponse(await trackIdsInRegion(region));
  });
}
