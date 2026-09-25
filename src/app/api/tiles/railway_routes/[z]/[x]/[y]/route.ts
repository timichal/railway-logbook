import { cookies } from "next/headers";
import { userFromRequest } from "@/lib/api/auth";
import { COOKIE_NAME, verifyToken } from "@/lib/authTokens";
import { normalizeCountryCodes } from "@/lib/constants";
import { ZOOM_RANGES } from "@/lib/map/zoomRanges";
import { type RouteTileRidesOf, routeTile } from "@/lib/routeTileQueries";

type Context = { params: Promise<{ z: string; x: string; y: string }> };

/**
 * GET /api/tiles/railway_routes/:z/:x/:y — the route tile coloured by someone's rides.
 *
 * Whose rides is never a parameter. It is resolved here, on every tile:
 *
 *  - `?share=<token>` — a shared map's owner, and only while sharing is on, so
 *    switching it off stops the tiles of a map someone already has open;
 *  - otherwise `Authorization: Bearer` — the native app's access token;
 *  - otherwise the web session cookie — the owner's own map.
 *
 * **A refusal is a refusal, never a plainer tile.** No session (expired, or
 * logged out in another tab) is a 401 and a dead share link a 404, so the map
 * stops drawing routes rather than drawing them all unridden. On purpose: an
 * uncoloured tile is indistinguishable from a logbook with nothing in it, and a
 * map that quietly lies about what has been ridden is worse than an empty one.
 *
 * Reading the cookie is safe here where it would not be under `/api/v1`: this is
 * a read that changes nothing, the cookie is `SameSite=Lax` so a cross-site page
 * embedding the URL sends none, and without CORS headers it could not read the
 * answer anyway.
 *
 * `?selected_countries=<JSON array>` filters as Martin's `railway_routes_tile`
 * does, and `?v=` is the client's cache buster, ignored here. The tile with no
 * user is still Martin's; see `createRailwayRoutesSource`.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  const tile = parseTile(await context.params);
  if (!tile) return new Response("Invalid tile coordinates", { status: 400 });

  const url = new URL(request.url);
  const countries = parseCountries(url.searchParams.get("selected_countries"));
  if (countries === undefined) {
    return new Response("selected_countries must be a JSON array", { status: 400 });
  }

  const rides = await resolveRides(request, url);
  if ("status" in rides) return new Response(null, { status: rides.status });

  try {
    const body = await routeTile(tile.z, tile.x, tile.y, rides, countries);
    // A dead share link: unknown token, or sharing switched off since the page loaded.
    if (body === null) return new Response(null, { status: 404 });

    // The same URL answers differently per session, so no shared cache may keep it.
    const headers = { "Cache-Control": "private, no-store" };
    if (body.length === 0) return new Response(null, { status: 204, headers });

    // A view over the Buffer's own bytes rather than `new Uint8Array(body)`, which
    // would copy a tile of up to a few hundred KB on every request. The cast only
    // narrows `ArrayBufferLike`: pg allocates a plain ArrayBuffer, never a shared one.
    const bytes = new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength);
    return new Response(bytes, {
      headers: { ...headers, "Content-Type": "application/x-protobuf" },
    });
  } catch (error) {
    console.error("Route tile failed:", error);
    return new Response(null, { status: 500 });
  }
}

/**
 * Whose rides colour the tile, or the status to refuse with. A share token is
 * passed on unresolved: `routeTile` checks it in the same query that draws the
 * tile, and answers null for a dead one.
 */
async function resolveRides(
  request: Request,
  url: URL,
): Promise<RouteTileRidesOf | { status: number }> {
  const share = url.searchParams.get("share");
  if (share !== null) return { shareToken: share };

  if (request.headers.has("authorization")) {
    const user = await userFromRequest(request);
    return user ? { userId: user.id } : { status: 401 };
  }

  const session = (await cookies()).get(COOKIE_NAME)?.value;
  const user = session ? await verifyToken(session) : null;
  return user ? { userId: user.id } : { status: 401 };
}

function parseTile(params: { z: string; x: string; y: string }) {
  const [z, x, y] = [params.z, params.x, params.y].map((value) =>
    /^\d{1,6}$/.test(value) ? Number(value) : Number.NaN,
  );
  const { min, max } = ZOOM_RANGES.railwayRoutes;
  if (!(z >= min && z <= max)) return null;

  const span = 2 ** z;
  if (!(x < span && y < span)) return null;
  return { z, x, y };
}

/** Absent: every route (null). Malformed: undefined, which is a 400. */
function parseCountries(raw: string | null): string[] | null | undefined {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeCountryCodes(parsed) : undefined;
  } catch {
    return undefined;
  }
}
