import { requireUser } from "@/lib/api/auth";
import { optionalCountries, requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { progressForUser } from "@/lib/progressQueries";

/**
 * GET /api/v1/progress?region=&countries= — the km and route counts.
 *
 * `countries` absent means no country filter; `countries=` (empty) means the
 * filter excludes everything, which is a real state the web app can be in and
 * answers zeros. Only Regular routes count, as on the web.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const region = requireRegion(url);

    return jsonResponse(await progressForUser(user.id, region, optionalCountries(url)));
  });
}
