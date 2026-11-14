import { optionalInt, requireIdParam, requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { requireSessionUser, sessionJson } from "@/lib/api/webSession";
import { journeysAndTripsForUser } from "@/lib/tripQueries";

/**
 * GET /api/me/logbook?region=&page=&pageSize=&search=&focus= — one page of My
 * Trips: trips and standalone journeys in `region`, newest first. With `focus`
 * (a journey id), the page that lists that journey (see journeysAndTripsForUser).
 * A route handler for the reason `api/me/progress` gives.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireSessionUser();
    const url = new URL(request.url);
    const region = requireRegion(url);
    const focus = url.searchParams.get("focus");

    return sessionJson(
      await journeysAndTripsForUser(
        user.id,
        optionalInt(url, "page", 1),
        optionalInt(url, "pageSize", 10),
        url.searchParams.get("search") ?? "",
        region,
        focus === null ? null : requireIdParam(focus, "focus"),
      ),
    );
  });
}
