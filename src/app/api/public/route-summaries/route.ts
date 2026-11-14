import { requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { routesCachedJson } from "@/lib/api/routesCache";
import { routeSummariesInRegion } from "@/lib/routeQueries";

/**
 * GET /api/public/route-summaries?region= — every route in a region as a
 * `RouteSummary`: what a logged-out visitor with a local log works their
 * progress, colouring and ridden stretches out from (`dataAccess.ts`). ~720KB
 * for Europe and the same for everyone, so kept per `routesFingerprint` and held
 * by the browser (`routesCachedJson`).
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const region = requireRegion(new URL(request.url));
    return routesCachedJson(request, `route-summaries/${region}`, async () =>
      JSON.stringify(await routeSummariesInRegion(region)),
    );
  });
}
