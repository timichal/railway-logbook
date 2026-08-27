import { requireUser } from "@/lib/api/auth";
import { requireRegion } from "@/lib/api/params";
import { apiHandler, assertOk, jsonResponse } from "@/lib/api/response";
import { unassignedJourneysForUser } from "@/lib/tripQueries";

/**
 * GET /api/v1/journeys/unassigned?region= — journeys filed under no trip, for
 * the assignment picker. Region-scoped for the same reason the picker is on the
 * web: a journey from the other side of the planet has no business in the list.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const region = requireRegion(new URL(request.url));

    const result = await unassignedJourneysForUser(user.id, region);
    assertOk(result);

    return jsonResponse({ journeys: result.journeys });
  });
}
