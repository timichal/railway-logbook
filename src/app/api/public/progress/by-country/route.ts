import { requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { networkProgressByCountry } from "@/lib/progressQueries";

/**
 * GET /api/public/progress/by-country?region= — the network's km per country and
 * usage type with nothing ridden, for Map & Stats when the visitor's local log is
 * empty (see `api/public/progress`).
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const region = requireRegion(new URL(request.url));

    return jsonResponse(await networkProgressByCountry(region));
  });
}
