import { adminScenicLines } from "@/lib/adminScenicLineQueries";
import { requireRegion } from "@/lib/api/params";
import { adminRead } from "@/lib/api/webSession";

/**
 * GET /api/admin/scenic-lines?region= — the admin's scenic lines list. A route
 * handler for the reason `api/admin/routes` gives.
 */
export function GET(request: Request): Promise<Response> {
  return adminRead(() => adminScenicLines(requireRegion(new URL(request.url))));
}
