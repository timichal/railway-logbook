import { optionalCountries, optionalIntList, requireRegion } from "@/lib/api/params";
import { apiHandler, noStoreJson } from "@/lib/api/response";
import { sharedMapProgress } from "@/lib/publicMapQueries";

type Context = { params: Promise<{ token: string }> };

/**
 * GET /api/shared/:token/progress?region=&countries=&usage= — a shared map's km
 * and route counts, for its progress box. A 404 once the link is dead, never
 * zeros, which would pass for a map with nothing ridden (as the route tile).
 *
 * The shared map's reads are route handlers, not server actions, for the reason
 * `api/me/progress` gives. The token is resolved on every call, so switching
 * sharing off stops a map already open, and the answer is `no-store` for the
 * same reason. `countries` and `usage` keep their three states, as there.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const { token } = await context.params;
    const url = new URL(request.url);
    const region = requireRegion(url);

    return noStoreJson(
      await sharedMapProgress(token, region, optionalCountries(url), optionalIntList(url, "usage")),
    );
  });
}
