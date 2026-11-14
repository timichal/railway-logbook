import { requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { routesCachedJson } from "@/lib/api/routesCache";
import { trackIdsInRegion } from "@/lib/routeQueries";

/**
 * GET /api/public/track-ids?region= — the ids of every route in a region, which
 * tell the local journey list which of its journeys belong to the region on
 * screen. Public, for the reason `api/public/stations` gives, and the same for
 * everyone, so kept per `routesFingerprint` (`routesCachedJson`).
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const region = requireRegion(new URL(request.url));
    return routesCachedJson(request, `track-ids/${region}`, async () =>
      JSON.stringify(await trackIdsInRegion(region)),
    );
  });
}
