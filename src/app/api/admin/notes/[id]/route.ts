import { adminNote } from "@/lib/adminNotesQueries";
import { requireIdParam } from "@/lib/api/params";
import { adminRead } from "@/lib/api/webSession";

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/notes/:id — one admin note, for the map's notes popup: `null`
 * when it is gone (see `adminNote`). A route handler for the reason
 * `api/admin/routes` gives.
 */
export function GET(_request: Request, context: Context): Promise<Response> {
  return adminRead(async () => {
    const { id } = await context.params;
    return adminNote(requireIdParam(id, "note id"));
  });
}
