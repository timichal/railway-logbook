/**
 * Plumbing for the tile handlers under `src/app/api/tiles` — the tiles the app
 * serves itself rather than leaving to Martin, because whether to answer depends
 * on who is asking (see "Vector tiles" in CLAUDE.md). That is the admin notes
 * alone, checked against the session cookie (`webSession.ts`).
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
 * An MVT tile as the response, 204 when it is empty, and never kept by any cache:
 * a tile served here depends on who asked (`private`), and the admin's edits must
 * show on the next fetch (`no-store`).
 *
 * **Sent uncompressed, on purpose; Caddy compresses it.** Next (from 16.4.5)
 * drops a route handler's `Content-Encoding` but keeps its body, so a tile gzipped
 * here went out as gzip bytes labelled as nothing, Caddy's `encode` gzipped it
 * again, and the browser, undoing one layer, handed MapLibre gzip instead of
 * protobuf: every tile errored (it was the signed-in map's route tiles then). Next
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
