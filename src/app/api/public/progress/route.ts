import { optionalCountries, optionalIntList, requireRegion } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { networkProgress } from "@/lib/progressQueries";

/**
 * GET /api/public/progress?region=&countries=&usage= — the network's km and
 * route counts with nothing ridden: the progress box of a logged-out visitor
 * whose local log is empty, who then needn't load the route summaries
 * (`dataAccess.ts`). `countries` and `usage` keep their three states, as
 * `api/me/progress`. Public, for the reason `api/public/stations` gives.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const url = new URL(request.url);
    const region = requireRegion(url);

    return jsonResponse(
      await networkProgress(region, optionalCountries(url), optionalIntList(url, "usage")),
    );
  });
}
