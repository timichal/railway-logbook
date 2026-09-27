import { requireUser } from "@/lib/api/auth";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { coveredStretchesForUser } from "@/lib/progressQueries";

/**
 * GET /api/v1/coverage — the stretches the user has ridden on routes they haven't
 * finished, as drawable geometry for the map's coverage overlay.
 *
 * Not region-scoped, as on the web: the overlay repeats the route layer's country
 * filter, which already keeps the other region's stretches off the map.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);

    return jsonResponse({ stretches: await coveredStretchesForUser(user.id) });
  });
}
