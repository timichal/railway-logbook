/**
 * The route tile coloured by one user's rides.
 *
 * Not a Martin source on purpose: Martin answers anyone who asks, and when it
 * took `user_id` from the query string it served any user's ride history to
 * anyone who typed a number. The SQL function behind it, `railway_routes_mvt`
 * (`database/init/02-vector-tiles.sql`), is left out of Martin's config, and this
 * module is the only thing that calls it with a user. Callers resolve *which*
 * user first — the tile handler under `src/app/api/tiles`, from the session, a
 * bearer token or a share token — the same split as `progressQueries.ts`. What it
 * cannot settle without the database, whether that token still stands, is settled
 * inside the tile query itself (see `routeTile`).
 */

import { Pool } from "pg";
import type { TokenClaims } from "./authTokens";
import { dbConfig } from "./dbConfig";
import { isPlausibleShareToken, sharedMapOwnerIdSql } from "./publicMapQueries";
import { currentAccountIdSql, issuedAtParam } from "./sessionQueries";

/**
 * A pool of its own, because a map view asks for a dozen or more tiles at once
 * and a low-zoom tile takes a few hundred milliseconds. On the app's shared pool
 * (10 connections) one pan would queue every server action behind it — the
 * logging, the planner, the progress box. Martin, which used to serve these, had
 * its own 20. Exported for the app's other tile, the admin notes
 * (`adminNotesTileQueries.ts`), for the same reason.
 */
export const tilePool = new Pool({ ...dbConfig, max: 10 });

// An idle connection that dies (Postgres restarted, an idle timeout) is reported
// as an 'error' on the pool. Unlistened, that is an uncaught exception, and it
// would take the whole Next process down with it; the pool has already dropped
// the connection and opens a new one on the next query.
tilePool.on("error", (error) => {
  console.error("Idle route tile connection failed:", error.message);
});

/**
 * Whose rides: a session's or access token's claims (signature checked, account
 * not yet), or a share token. Both are resolved to a user inside the tile query.
 */
export type RouteTileRidesOf = { claims: TokenClaims } | { shareToken: string };

/**
 * One route tile as MVT bytes, coloured by the rides of `of`.
 *
 * `selectedCountries` null shows every route; a list keeps the routes with both
 * endpoints in it (an empty list, none). An empty buffer is an empty tile.
 *
 * **Null means whoever it was no longer answers** — for a share token, an unknown
 * one or sharing switched off (`sharedMapOwnerIdSql`); for claims, a token from
 * before a password change or of an account that is gone (`currentAccountIdSql`).
 * Either rule is applied in the same statement that draws the tile, so a tile is
 * one round trip on this pool: checking first on the app's pool would put every
 * tile of every pan there as well. The CASE keeps a dead token from falling
 * through to `railway_routes_mvt(…, NULL, …)`, which is the anonymous tile and
 * would draw the routes with nothing ridden.
 */
export async function routeTile(
  z: number,
  x: number,
  y: number,
  of: RouteTileRidesOf,
  selectedCountries: string[] | null,
): Promise<Buffer | null> {
  let ownerSql: string;
  let params: unknown[];
  if ("claims" in of) {
    ownerSql = currentAccountIdSql("$4", "$6");
    params = [z, x, y, of.claims.userId, selectedCountries, issuedAtParam(of.claims)];
  } else {
    if (!isPlausibleShareToken(of.shareToken)) return null;
    ownerSql = sharedMapOwnerIdSql("$4");
    params = [z, x, y, of.shareToken, selectedCountries];
  }

  const result = await tilePool.query<{ owner_id: number | null; tile: Buffer | null }>(
    `WITH owner AS (SELECT ${ownerSql} AS user_id)
     SELECT owner.user_id AS owner_id,
            CASE WHEN owner.user_id IS NOT NULL
                 THEN railway_routes_mvt($1, $2, $3, owner.user_id, $5::text[])
            END AS tile
     FROM owner`,
    params,
  );

  const row = result.rows[0];
  if (row?.owner_id == null) return null;
  return row.tile ?? Buffer.alloc(0);
}
