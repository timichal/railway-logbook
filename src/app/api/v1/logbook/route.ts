import { requireUser } from "@/lib/api/auth";
import { optionalInt, requireRegion } from "@/lib/api/params";
import { apiHandler, assertOk, jsonResponse } from "@/lib/api/response";
import { journeysAndTripsForUser } from "@/lib/tripQueries";

/**
 * GET /api/v1/logbook?region=&page=&pageSize=&search= — the browsing list: one
 * row per trip (with its journeys nested) or standalone journey, newest first.
 *
 * Paginated server-side, as on the web — the page is what the query orders and
 * hydrates, so a client must not try to sort or filter a page it has been given.
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const region = requireRegion(url);

    const result = await journeysAndTripsForUser(
      user.id,
      optionalInt(url, "page", 1),
      optionalInt(url, "pageSize", 10),
      url.searchParams.get("search") ?? "",
      region,
    );
    assertOk(result);

    return jsonResponse({ items: result.items, total: result.total });
  });
}
