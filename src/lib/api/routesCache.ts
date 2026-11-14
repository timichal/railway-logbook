/**
 * Public, user-less JSON read from `railway_routes`, kept in memory until the
 * routes change: the route details (`api/route-details`), the route summaries
 * and the region's track ids (`api/public`).
 */

import { createHash } from "node:crypto";
import { routesFingerprint } from "../routesFingerprint";

interface CachedBody {
  fingerprint: string;
  etag: string;
  body: Promise<string>;
}

/** Per key, the answer for the routes as they last were. */
const cache = new Map<string, CachedBody>();

/**
 * Part of every ETag, so a deploy (which restarts the server) invalidates what
 * browsers hold even when no route changed: the answer's shape may have.
 */
const SERVER_STARTED = Date.now().toString(36);

/**
 * Answers `request` with the JSON text `build` makes, kept per `key` (which must
 * name everything the answer depends on: what it is and the region) until
 * `routesFingerprint` moves. Its ETag follows the fingerprint, so a browser that
 * holds the answer revalidates and gets a 304 for the price of the fingerprint
 * (one primary-key read), not of the query. A deploy changes it too (`SERVER_STARTED`).
 *
 * The browser revalidates on every load (`no-cache`), so a change is seen on the
 * next one. Not `stale-while-revalidate`: that answers the first load after a
 * deploy from the old copy before the new ETag is seen, and the new client
 * would read the old shape.
 *
 * Everything served this way is public and the same for everyone, so `build`
 * must never read a session.
 */
export async function routesCachedJson(
  request: Request,
  key: string,
  build: () => Promise<string>,
): Promise<Response> {
  const fingerprint = await routesFingerprint();

  let cached = cache.get(key);
  if (cached?.fingerprint !== fingerprint) {
    const etag = createHash("sha1").update(`${SERVER_STARTED}/${key}/${fingerprint}`).digest("hex");
    const body = build();
    cached = { fingerprint, etag, body };
    cache.set(key, cached);
    // A failed read must not be served from now on
    const entry = cached;
    body.catch(() => {
      if (cache.get(key) === entry) cache.delete(key);
    });
  }

  const headers = {
    ETag: `"${cached.etag}"`,
    "Cache-Control": "public, no-cache",
  };
  // Compared by inclusion: a proxy that compresses the body (Caddy) may hand the
  // tag back weakened or with an encoding suffix
  if (request.headers.get("if-none-match")?.includes(cached.etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(await cached.body, {
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
