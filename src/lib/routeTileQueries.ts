/**
 * The route tile coloured by one user's rides.
 *
 * Not a Martin source on purpose: Martin answers anyone who asks, and when it
 * took `user_id` from the query string it served any user's ride history to
 * anyone who typed a number. The SQL function behind it, `railway_routes_mvt`
 * (`database/init/02-vector-tiles.sql`), is left out of Martin's config, and this
 * module is the only thing that calls it with a user. Callers resolve *which*
 * user first — the tile handler under `src/app/api/tiles`, from the session or a
 * bearer token — the same split as `progressQueries.ts`. A share token is the
 * exception: it is resolved inside the tile query itself (see `routeTile`).
 */

import { Pool } from "pg";
import { dbConfig } from "./dbConfig";
import { isPlausibleShareToken, sharedMapOwnerIdSql } from "./publicMapQueries";

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

/** Whose rides: a user already resolved, or a share token still to be. */
export type RouteTileRidesOf = { userId: number } | { shareToken: string };

/**
 * One route tile as MVT bytes, coloured by the rides of `of`.
 *
 * `selectedCountries` null shows every route; a list keeps the routes with both
 * endpoints in it (an empty list, none). An empty buffer is an empty tile.
 *
 * **Null means the share link is dead** — an unknown token, or sharing switched
 * off. The token is resolved in the same statement that draws the tile, through
 * the one share rule (`sharedMapOwnerIdSql`), so a shared map's tile is one round
 * trip on this pool: looking the token up first through `publicMapOwner` would put
 * every tile of every visitor's pan on the app's own pool as well. The CASE keeps
 * a dead token from falling through to `railway_routes_mvt(…, NULL, …)`, which is
 * the anonymous tile and would draw the routes with nothing ridden.
 */
export async function routeTile(
  z: number,
  x: number,
  y: number,
  of: RouteTileRidesOf,
  selectedCountries: string[] | null,
): Promise<Buffer | null> {
  if ("userId" in of) {
    const result = await tilePool.query<{ tile: Buffer | null }>(
      "SELECT railway_routes_mvt($1, $2, $3, $4, $5::text[]) AS tile",
      [z, x, y, of.userId, selectedCountries],
    );
    return result.rows[0]?.tile ?? Buffer.alloc(0);
  }

  if (!isPlausibleShareToken(of.shareToken)) return null;

  const result = await tilePool.query<{ owner_id: number | null; tile: Buffer | null }>(
    `WITH owner AS (SELECT ${sharedMapOwnerIdSql("$4")} AS user_id)
     SELECT owner.user_id AS owner_id,
            CASE WHEN owner.user_id IS NOT NULL
                 THEN railway_routes_mvt($1, $2, $3, owner.user_id, $5::text[])
            END AS tile
     FROM owner`,
    [z, x, y, of.shareToken, selectedCountries],
  );

  const row = result.rows[0];
  if (row?.owner_id == null) return null;
  return row.tile ?? Buffer.alloc(0);
}
