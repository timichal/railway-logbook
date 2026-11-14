import { createHash } from "node:crypto";
import { requireRegion } from "@/lib/api/params";
import { apiHandler } from "@/lib/api/response";
import { routeDetailsJson } from "@/lib/routeQueries";
import { routesFingerprint } from "@/lib/routesFingerprint";
import type { RegionId } from "@/lib/shared/regions";

interface CachedDetails {
  fingerprint: string;
  etag: string;
  body: Promise<string>;
}

/** Per region, the answer for the routes as they last were. */
const cache = new Map<RegionId, CachedDetails>();

/**
 * Part of every ETag, so a deploy (which restarts the server) invalidates what
 * browsers hold even when no route changed: the answer's shape may have.
 */
const SERVER_STARTED = Date.now().toString(36);

/**
 * GET /api/route-details?region=<id> — every route's `RouteDetails` in a region:
 * the text the web map's popups and clicks need, which the route tile no longer
 * carries (see railway_routes_mvt).
 *
 * Public and the same for everyone, so it takes no session and must never take
 * one. The body changes only when a route does, so it is kept in memory per
 * `routesFingerprint` and its ETag follows the fingerprint: a browser that has it
 * revalidates on every load (`no-cache`) and gets a 304 for the price of the
 * fingerprint (~5ms), not of the query (~300ms). A deploy changes it too
 * (`SERVER_STARTED`). An admin's save is seen on the next load, or at once by a
 * client that asks again (`loadRouteDetails`).
 */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const region = requireRegion(new URL(request.url));
    const fingerprint = await routesFingerprint();

    let cached = cache.get(region);
    if (cached?.fingerprint !== fingerprint) {
      const etag = createHash("sha1")
        .update(`${SERVER_STARTED}/${region}/${fingerprint}`)
        .digest("hex");
      const body = routeDetailsJson(region);
      cached = { fingerprint, etag, body };
      cache.set(region, cached);
      // A failed read must not be served from now on
      const entry = cached;
      body.catch(() => {
        if (cache.get(region) === entry) cache.delete(region);
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
  });
}
