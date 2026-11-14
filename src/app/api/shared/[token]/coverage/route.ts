import { requireRegion } from "@/lib/api/params";
import { apiHandler, noStoreJson } from "@/lib/api/response";
import { sharedMapCoveredStretches } from "@/lib/publicMapQueries";

type Context = { params: Promise<{ token: string }> };

/**
 * GET /api/shared/:token/coverage?region= — the stretches a shared map's owner
 * has ridden on routes they haven't completed, for its coverage overlay. A 404
 * once the link is dead. A route handler, resolving the token on every call, for
 * the reasons `api/shared/:token/progress` gives.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const { token } = await context.params;
    const region = requireRegion(new URL(request.url));

    return noStoreJson(await sharedMapCoveredStretches(token, region));
  });
}
