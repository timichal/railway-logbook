import { readJsonBody, requireRegion, trackIdList } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { routeBoundsByIds } from "@/lib/routeQueries";

/**
 * POST /api/public/routes/bounds?region= — { trackIds } → the bounding box of
 * those routes in `region` (`routeBoundsByIds`), or null. What opening a local
 * journey flies to; the journey, trip and planner reads return their box with
 * their result. A POST and public, for the reasons `api/public/routes` gives.
 */
export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const region = requireRegion(new URL(request.url));
    const trackIds = trackIdList(await readJsonBody(request), "trackIds");

    return jsonResponse(await routeBoundsByIds(trackIds, region));
  });
}
