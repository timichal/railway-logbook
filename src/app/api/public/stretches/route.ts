import { readJsonBody, requireUncheckedArray } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { buildCoveredStretches, normalizeCoveredRanges } from "@/lib/progressQueries";
import type { CoveredRange } from "@/lib/shared/types";

/**
 * POST /api/public/stretches — { ranges } → the ridden stretches, as
 * `api/me/coverage` draws them, for ranges the caller holds itself: the
 * localStorage journeys of a visitor who isn't signed in. Route geometry is
 * public (it is served as tiles to anyone), so the ranges are validated and
 * capped instead of authenticated: `normalizeCoveredRanges` drops a malformed
 * one and keeps the first `MAX_COVERED_RANGES`, as the action it replaced did.
 * A POST and public, for the reasons `api/public/routes` gives.
 */
export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const ranges = requireUncheckedArray(await readJsonBody(request), "ranges");

    return jsonResponse(
      await buildCoveredStretches(normalizeCoveredRanges(ranges as CoveredRange[])),
    );
  });
}
