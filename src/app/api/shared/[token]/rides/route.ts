import { requireRegion } from "@/lib/api/params";
import { apiHandler, noStoreJson } from "@/lib/api/response";
import { sharedMapRouteRides } from "@/lib/publicMapQueries";

type Context = { params: Promise<{ token: string }> };

/**
 * GET /api/shared/:token/rides?region= — every route a shared map's owner has
 * ridden in `region`, for its colours. A 404 once the link is dead, and the map
 * then draws no routes: drawn uncoloured, they would pass for a map with nothing
 * ridden. A route handler, resolving the token on every call, for the reasons
 * `api/shared/:token/progress` gives.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const { token } = await context.params;
    const region = requireRegion(new URL(request.url));

    return noStoreJson(await sharedMapRouteRides(token, region));
  });
}
