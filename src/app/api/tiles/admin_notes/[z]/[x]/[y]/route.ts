import { adminNotesTile } from "@/lib/adminNotesTileQueries";
import { mvtResponse, parseTile, sessionUser } from "@/lib/api/tiles";
import { ZOOM_RANGES } from "@/lib/shared/map/zoomRanges";

type Context = { params: Promise<{ z: string; x: string; y: string }> };

/**
 * GET /api/tiles/admin_notes/:z/:x/:y — every admin note, for the admin map.
 *
 * Admin only (user_id=1), checked on every tile against the web session cookie,
 * as every admin server action checks it. No bearer token: the native app has no
 * admin view. No session is a 401 and someone else's a 403, so the notes layer
 * simply stays empty for anyone else. The public map's notes are
 * `public_notes_tile`, which Martin serves to anyone.
 *
 * Reading the cookie is safe for the reasons the route tile handler gives: a read
 * that changes nothing, a `SameSite=Lax` cookie, and no CORS headers. `?v=` is the
 * admin map's cache buster, ignored here.
 */
export async function GET(_request: Request, context: Context): Promise<Response> {
  const tile = parseTile(await context.params, ZOOM_RANGES.adminNotes);
  if (!tile) return new Response("Invalid tile coordinates", { status: 400 });

  const user = await sessionUser();
  if (!user) return new Response(null, { status: 401 });
  if (user.id !== 1) return new Response(null, { status: 403 });

  try {
    return mvtResponse(await adminNotesTile(tile.z, tile.x, tile.y));
  } catch (error) {
    console.error("Admin notes tile failed:", error);
    return new Response(null, { status: 500 });
  }
}
