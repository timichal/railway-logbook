import { adminRoutes } from "@/lib/adminRouteQueries";
import { requireRegion } from "@/lib/api/params";
import { adminRead } from "@/lib/api/webSession";

/**
 * GET /api/admin/routes?region= — the admin routes list: every route in the
 * region, metadata and flags, no geometry.
 *
 * The admin page's reads are route handlers, not server actions, for the reason
 * `api/me/progress` gives: Next runs a client's actions one at a time, so as
 * actions the page's loads queued behind each other and behind the route
 * preview's path search. Writes stay actions. Every handler here is an
 * `adminRead`, which checks the admin session first, as `asAdmin` does for an
 * action.
 */
export function GET(request: Request): Promise<Response> {
  return adminRead(() => adminRoutes(requireRegion(new URL(request.url))));
}
