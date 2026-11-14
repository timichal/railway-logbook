import { readJsonBody, trackIdList } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { routeMetadataByIds } from "@/lib/routeQueries";

/**
 * POST /api/public/routes — { trackIds } → the routes' metadata, which labels the
 * routes of a journey held in localStorage (it keeps only their ids). A POST for
 * a read because the id list is no way to fill a query string. Public, for the
 * reason `api/public/stations` gives.
 */
export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const trackIds = trackIdList(await readJsonBody(request), "trackIds");

    return jsonResponse(await routeMetadataByIds(trackIds));
  });
}
