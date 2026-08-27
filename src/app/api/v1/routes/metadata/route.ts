import { readJsonBody, requireIntArray } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { routeMetadataByIds } from "@/lib/routeQueries";

/**
 * POST /api/v1/routes/metadata — { trackIds } → route metadata, no geometry.
 *
 * A POST for a read because the id list is the argument and can run to
 * thousands, which is no way to fill a query string. Public: route data is.
 */
export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const body = await readJsonBody(request);
    const trackIds = requireIntArray(body, "trackIds");

    return jsonResponse({ routes: await routeMetadataByIds(trackIds) });
  });
}
