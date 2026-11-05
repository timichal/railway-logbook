/**
 * Plumbing for the tile handlers under `src/app/api/tiles` — the tiles the app
 * serves itself rather than leaving to Martin, because whether to answer depends
 * on who is asking (see "Vector tiles" in CLAUDE.md).
 */

import { cookies } from "next/headers";
import { COOKIE_NAME, readToken, type TokenClaims } from "../authTokens";

/**
 * What the web session's cookie claims, or null. Tile handlers are, besides
 * `api/session` (which renews it), the only route handlers that read the cookie
 * (see "Vector tiles" in CLAUDE.md); this is the one place they do it. Not `authActions.getUser`, which is a `"use server"`
 * module a route handler must not import.
 *
 * Signature checked, **not** held against the account: the tile query does that
 * (`currentAccountIdSql`), so a tile stays one round trip on the tile pool.
 */
export async function sessionClaims(): Promise<TokenClaims | null> {
  const session = (await cookies()).get(COOKIE_NAME)?.value;
  return session ? readToken(session) : null;
}

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
 * An MVT tile as the response, 204 when it is empty. `private, no-store`, because
 * every tile served from here answers differently per requester, so no shared
 * cache may keep one.
 *
 * **Sent uncompressed, on purpose; Caddy compresses it.** Next (from 16.4.5)
 * drops a route handler's `Content-Encoding` but keeps its body, so a tile gzipped
 * here went out as gzip bytes labelled as nothing, Caddy's `encode` gzipped it
 * again, and the browser, undoing one layer, handed MapLibre gzip instead of
 * protobuf: every route tile errored and the signed-in map drew no routes. Next
 * itself won't compress it (no protobuf type is compressible in its mime-db), so
 * in development, with no Caddy in front, tiles go out as they are.
 */
export function mvtResponse(body: Buffer): Response {
  const headers: Record<string, string> = { "Cache-Control": "private, no-store" };
  if (body.length === 0) return new Response(null, { status: 204, headers });

  headers["Content-Type"] = "application/x-protobuf";
  // A view over the Buffer's own bytes rather than `new Uint8Array(body)`, which
  // would copy a tile of up to a few hundred KB on every request. The cast only
  // narrows `ArrayBufferLike`: pg never allocates a shared one.
  const bytes = new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength);
  return new Response(bytes, { headers });
}
