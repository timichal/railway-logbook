import { requireRegion } from "@/lib/api/params";
import { apiHandler, noStoreJson } from "@/lib/api/response";
import { sharedMapProgressByCountry } from "@/lib/publicMapQueries";

type Context = { params: Promise<{ token: string }> };

/**
 * GET /api/shared/:token/progress/by-country?region= — a shared map's progress
 * per country and per counted usage type, for Map & Stats. A 404 once the link
 * is dead. A route handler, resolving the token on every call, for the reasons
 * `api/shared/:token/progress` gives.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  return apiHandler(async () => {
    const { token } = await context.params;
    const region = requireRegion(new URL(request.url));

    return noStoreJson(await sharedMapProgressByCountry(token, region));
  });
}
