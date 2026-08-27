import { requireUser } from "@/lib/api/auth";
import { readJsonBody, requireIdParam, requireLoggedRoutes } from "@/lib/api/params";
import { apiHandler, assertOk, jsonResponse } from "@/lib/api/response";
import { addRoutesToJourneyForUser } from "@/lib/journeyQueries";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/journeys/:id/routes — add routes to an existing journey.
 *
 * `{ routes: [{ trackId, partial?, covered? }] }`. A route already in the
 * journey has its partial flag and stretch overwritten rather than duplicated.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const { id } = await context.params;
    const journeyId = requireIdParam(id, "journey id");

    const body = await readJsonBody(request);
    const { trackIds, partialFlags, coveredRanges } = requireLoggedRoutes(body, "routes");

    const result = await addRoutesToJourneyForUser(
      user.id,
      journeyId,
      trackIds,
      partialFlags,
      coveredRanges,
    );
    assertOk(result);

    return jsonResponse({ success: true });
  });
}
