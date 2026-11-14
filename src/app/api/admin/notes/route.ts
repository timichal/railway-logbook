import { adminNotes } from "@/lib/adminNotesQueries";
import { requireRegion } from "@/lib/api/params";
import { adminRead } from "@/lib/api/webSession";

/**
 * GET /api/admin/notes?region= — the region's admin notes, for the Notes tab.
 * A route handler for the reason `api/admin/routes` gives.
 */
export function GET(request: Request): Promise<Response> {
  return adminRead(() => adminNotes(requireRegion(new URL(request.url))));
}
