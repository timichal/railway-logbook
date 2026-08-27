import { requireUser } from "@/lib/api/auth";
import { optionalString, readJsonBody, requireRegion, requireString } from "@/lib/api/params";
import { apiHandler, assertOk, jsonResponse } from "@/lib/api/response";
import { createTripForUser, tripsForUser } from "@/lib/tripQueries";

/**
 * GET /api/v1/trips?region= — the user's trips with their stats.
 *
 * Region-scoped: a trip belongs to a region when one of its journeys logged a
 * route there, and a trip with no routes yet belongs to both, so a freshly
 * created one never vanishes from the list that made it.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const region = requireRegion(new URL(request.url));

    const result = await tripsForUser(user.id, region);
    assertOk(result);

    return jsonResponse({ trips: result.trips });
  });
}

/** POST /api/v1/trips — { name, description? }. */
export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const body = await readJsonBody(request);

    const result = await createTripForUser(
      user.id,
      requireString(body, "name"),
      optionalString(body, "description"),
    );
    assertOk(result);

    return jsonResponse({ trip: result.trip }, 201);
  });
}
