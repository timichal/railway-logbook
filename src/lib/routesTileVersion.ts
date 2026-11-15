/**
 * The route tile's version: what the user maps put in the route tile URL so that
 * Martin can serve it `immutable` (`railway_routes_tile_versioned` in
 * `martin/configuration.yml`). A tile is the same bytes for as long as its URL
 * carries the same version, so a browser keeps it for a year and Martin's memory
 * cache keeps it until evicted. A route write, or a change to the SQL that draws
 * the tile, gives every page rendered after it a new URL.
 */

import { createHmac } from "node:crypto";
import { resolveJwtSecret } from "./authTokens";
import pool from "./db";

/**
 * Everything the tile's bytes follow: the routes' `data_versions` counter (the
 * same one `routesFingerprint` reads, moved at the commit of every write) and the
 * definitions of the functions that draw it. `02-vector-tiles.sql` is re-applied
 * on every deploy and can change what the tile carries without writing a route,
 * and a browser holding the old tile would keep it for a year. PostGIS itself
 * isn't covered: an upgrade may change the bytes but not what the map shows.
 *
 * Name a new helper here when `railway_routes_tile` starts calling one. Ordered
 * by full signature, not name, so an overload left behind by an older version of
 * the file can't make the hash follow the plan.
 *
 * Read on every render rather than kept per process: `applyVectorTiles` may be
 * rerun by hand while the app runs (after a deploy's lock timeout). About 1ms.
 */
export const ROUTES_TILE_INPUTS_SQL = `
  SELECT
    dv.version::text AS version,
    (
      SELECT md5(string_agg(pg_get_functiondef(p.oid), E'\\n' ORDER BY p.oid::regprocedure::text))
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('railway_routes_tile', 'tile_unit')
    ) AS functions
  FROM data_versions dv
  WHERE dv.table_name = 'railway_routes'`;

export interface RoutesTileInputs {
  version: string;
  functions: string | null;
}

/**
 * The version as it goes in the URL: an HMAC of the inputs, not the counter
 * itself. Martin caches any URL anyone asks for, so a counter, whose next value
 * anyone can guess, would let a request for it ahead of the next route save fill
 * Martin's cache with today's tiles under tomorrow's URL. Every browser would then
 * hold them for a year. Keyed with the session secret, under a label of its own,
 * so the next version can't be worked out from this one. Rotating the secret just
 * moves every URL once. A made-up `v` still reaches Martin, which renders it and
 * caches it like any other: that costs what an uncached tile did before, and
 * pushes live tiles out of the LRU, but can't put a wrong tile under a real URL.
 */
export function routesTileVersionFrom(inputs: RoutesTileInputs, secret: Uint8Array): string {
  return createHmac("sha256", secret)
    .update(`railway_routes_tile:${inputs.version}:${inputs.functions ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

/** The current route tile version, read once per page render. */
export async function routesTileVersion(): Promise<string> {
  const { rows } = await pool.query<RoutesTileInputs>(ROUTES_TILE_INPUTS_SQL);
  const inputs = rows[0];
  // The row is seeded by 01-schema.sql; without it the version would never move
  if (inputs === undefined) throw new Error("data_versions has no railway_routes row");
  return routesTileVersionFrom(inputs, resolveJwtSecret());
}
