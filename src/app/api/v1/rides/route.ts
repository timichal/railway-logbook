import { requireUser } from "@/lib/api/auth";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { routeRidesForUser } from "@/lib/progressQueries";

/**
 * GET /api/v1/rides — every route the user has ridden, for the map's colours
 * (`RouteRide`): Martin's route tile is the same for everyone, and the app lays
 * these over it by id (`shared/map/routeRides.ts`).
 *
 * Not region-scoped, as `/coverage` isn't: the route layers' country filter
 * already keeps the other region's routes off the map.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);

    return jsonResponse({ rides: await routeRidesForUser(user.id, null) });
  });
}
