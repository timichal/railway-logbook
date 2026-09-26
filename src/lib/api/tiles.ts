/**
 * Plumbing for the tile handlers under `src/app/api/tiles` — the tiles the app
 * serves itself rather than leaving to Martin, because whether to answer depends
 * on who is asking (see "Vector tiles" in CLAUDE.md).
 */

import { cookies } from "next/headers";
import { COOKIE_NAME, type User, verifyToken } from "../authTokens";

/**
 * The web session's user, from the cookie, or null. Tile handlers are the only
 * route handlers that read the cookie (see "Vector tiles" in CLAUDE.md); this is
 * the one place they do it. Not `authActions.getUser`, which is a `"use server"`
 * module a route handler must not import.
 */
export async function sessionUser(): Promise<User | null> {
  const session = (await cookies()).get(COOKIE_NAME)?.value;
  return session ? verifyToken(session) : null;
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
 */
export function mvtResponse(body: Buffer): Response {
  const headers = { "Cache-Control": "private, no-store" };
  if (body.length === 0) return new Response(null, { status: 204, headers });

  // A view over the Buffer's own bytes rather than `new Uint8Array(body)`, which
  // would copy a tile of up to a few hundred KB on every request. The cast only
  // narrows `ArrayBufferLike`: pg allocates a plain ArrayBuffer, never a shared one.
  const bytes = new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength);
  return new Response(bytes, {
    headers: { ...headers, "Content-Type": "application/x-protobuf" },
  });
}
