import { requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { routesInRegion } from "@/lib/routeQueries";

/**
 * GET /api/v1/routes?region= — every route in a region, geometry included.
 *
 * Public and large (a few thousand routes with their linestrings). The app wants
 * it for the same reason the not-logged-in web visitor does: working out
 * progress against locally-held journeys, which needs route lengths and
 * geometry the tiles don't hand back as data.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const region = requireRegion(new URL(request.url));
    return jsonResponse({ routes: await routesInRegion(region) });
  });
}
