/**
 * Plumbing for the tile handlers under `src/app/api/tiles` — the tiles the app
 * serves itself rather than leaving to Martin, because whether to answer depends
 * on who is asking (see "Vector tiles" in CLAUDE.md). Who is asking comes from
 * `webSession.ts` (the cookie) or `auth.ts` (a bearer token).
 */

/** `z`/`x`/`y` from the path, or null when they are not a tile inside `zooms`. */
export function parseTile(
  params: { z: string; x: string; y: string },
  zooms: { min: number; max: number },
): { z: number; x: number; y: number } | null {
  const [z, x, y] = [params.z, params.x, params.y].map((value) =>
    /^\d{1,6}$/.test(value) ? Number(value) : Number.NaN,
  );
  if (!(z >= zooms.min && z <= zooms.max)) return null;

  const span = 2 ** z;
  if (!(x < span && y < span)) return null;
  return { z, x, y };
}

/**
 * How long the requester's own browser may keep a tile. Every tile served from
 * here answers differently per requester, so it is always `private`: no shared
 * cache may keep one.
 *
 *  - `"no-store"`: never kept. A shared map's tiles, so that switching sharing off
 *    stops a map someone already has open on its next tile; the admin notes.
 *  - `"session"`: kept for an hour, for the requester's own rides (the web session
 *    cookie or the native app's bearer token), and only when the request carries a
 *    `?v=`. Safe because the client's `v` names the moment as well as the tile: a
 *    new one on every page load (on the native app, every launch), on another
 *    account signing in, and on every write the client itself makes
 *    (`useUserMap`, `mobile/src/logbook/logVersion.ts`). So a kept tile is only
 *    ever reused by the page that fetched it, for a tile it has since dropped from
 *    memory, and never shows another account's rides. `Vary` on both credentials
 *    as a second fence: a cookie gone or replaced under the page (signed out or in
 *    elsewhere) misses the cache and gets the handler's refusal.
 *
 *    Changes the page didn't make itself — a ride logged in another tab or the
 *    other app, a session revoked with the cookie unchanged (a password changed on
 *    another device) — get a new `v` when the user comes back to the page: the web
 *    map refetches on every return the session check answers
 *    (`useSessionKeepAlive`'s `onRechecked`), the native app after a minute away. A
 *    page that never leaves view can redraw a dropped tile up to an hour old, as it
 *    always drew the tiles still in its memory. And `Vary: Cookie` misses on any
 *    cookie change, the daily session renewal included: a refetch, never a wrong tile.
 */
export type TileCaching = "no-store" | "session";

const CACHE_HEADERS: Record<TileCaching, Record<string, string>> = {
  "no-store": { "Cache-Control": "private, no-store" },
  session: { "Cache-Control": "private, max-age=3600", Vary: "Authorization, Cookie" },
};

/**
 * An MVT tile as the response, 204 when it is empty, cached as `caching` says.
 *
 * **Sent uncompressed, on purpose; Caddy compresses it.** Next (from 16.4.5)
 * drops a route handler's `Content-Encoding` but keeps its body, so a tile gzipped
 * here went out as gzip bytes labelled as nothing, Caddy's `encode` gzipped it
 * again, and the browser, undoing one layer, handed MapLibre gzip instead of
 * protobuf: every route tile errored and the signed-in map drew no routes. Next
 * itself won't compress it (no protobuf type is compressible in its mime-db), so
 * in development, with no Caddy in front, tiles go out as they are.
 */
export function mvtResponse(body: Buffer, caching: TileCaching): Response {
  const headers: Record<string, string> = { ...CACHE_HEADERS[caching] };
  if (body.length === 0) return new Response(null, { status: 204, headers });

  headers["Content-Type"] = "application/x-protobuf";
  // A view over the Buffer's own bytes rather than `new Uint8Array(body)`, which
  // would copy a tile of up to a few hundred KB on every request. The cast only
  // narrows `ArrayBufferLike`: pg never allocates a shared one.
  const bytes = new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength);
  return new Response(bytes, { headers });
}
