import { routeSuggestions } from "@/lib/adminRouteQueries";
import { adminRead } from "@/lib/api/webSession";

/**
 * GET /api/admin/routes/suggestions — the usage tags and line names in use, for
 * the route editor's inputs, across every region. A route handler for the reason
 * `api/admin/routes` gives.
 */
export function GET(): Promise<Response> {
  return adminRead(routeSuggestions);
}
