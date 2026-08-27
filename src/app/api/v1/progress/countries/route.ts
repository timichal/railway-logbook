import { requireUser } from "@/lib/api/auth";
import { requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { progressByCountryForUser } from "@/lib/progressQueries";

/**
 * GET /api/v1/progress/countries?region= — per-country km, plus the grand
 * total. One row per country the region declares, whether ridden or not.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const region = requireRegion(new URL(request.url));

    return jsonResponse(await progressByCountryForUser(user.id, region));
  });
}
