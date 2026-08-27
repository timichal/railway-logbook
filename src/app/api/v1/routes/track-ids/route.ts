import { requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { trackIdsInRegion } from "@/lib/routeQueries";

/**
 * GET /api/v1/routes/track-ids?region= — the ids of every route in a region.
 *
 * A few thousand integers: what a locally-held journey list uses to tell which
 * of its journeys belong to the region on screen, since it stores track ids and
 * nothing else.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const region = requireRegion(new URL(request.url));
    return jsonResponse({ trackIds: await trackIdsInRegion(region) });
  });
}
