import { readJsonBody, requireCoveredRanges } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { buildCoveredStretches, normalizeCoveredRanges } from "@/lib/progressQueries";

/**
 * POST /api/v1/coverage/stretches — { ranges } → { stretches }.
 *
 * Fraction ranges the client holds itself (journeys kept on the device), cut into
 * drawable geometry. Public, like `getCoveredStretchesFor` on the web: route
 * geometry is served as tiles to anyone, so the ranges are validated and capped
 * instead of authenticated.
 */
export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const body = await readJsonBody(request);
    const ranges = normalizeCoveredRanges(requireCoveredRanges(body, "ranges"));

    return jsonResponse({ stretches: await buildCoveredStretches(ranges) });
  });
}
