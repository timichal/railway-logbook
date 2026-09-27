/**
 * The admin notes tile: every note, drafts included.
 *
 * Not a Martin source on purpose, for the reason `routeTileQueries.ts` gives:
 * Martin answers anyone who asks, and published under `/tiles` this tile handed
 * the `Works`/`Todo`/`UsageInternal` notes — the ones `public_notes_tile` exists
 * to hide — to whoever typed its URL. The SQL function behind it,
 * `admin_notes_tile` (`database/init/02-vector-tiles.sql`), is left out of
 * Martin's config, and its only caller is the admin-checking handler under
 * `src/app/api/tiles/admin_notes`.
 *
 * On the route tile's pool, not the app's: a pan over the admin map asks for a
 * dozen tiles at once, and on the shared pool they would queue the admin's own
 * saves behind them.
 */

import type { TokenClaims } from "./authTokens";
import { tilePool } from "./routeTileQueries";
import { currentAccountIdSql, issuedAtParam } from "./sessionQueries";

/**
 * One admin notes tile as MVT bytes; an empty buffer is an empty tile. Null when
 * the claims are not the admin's as the account stands now — a token from before
 * a password change — checked in the same statement, as `routeTile` does.
 */
export async function adminNotesTile(
  z: number,
  x: number,
  y: number,
  claims: TokenClaims,
): Promise<Buffer | null> {
  const result = await tilePool.query<{ admin_id: number | null; tile: Buffer | null }>(
    `WITH admin AS (SELECT ${currentAccountIdSql("$4", "$5")} AS user_id)
     SELECT admin.user_id AS admin_id,
            CASE WHEN admin.user_id = 1 THEN admin_notes_tile($1, $2, $3) END AS tile
     FROM admin`,
    [z, x, y, claims.userId, issuedAtParam(claims)],
  );

  const row = result.rows[0];
  if (row?.admin_id !== 1) return null;
  return row.tile ?? Buffer.alloc(0);
}
