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

import { tilePool } from "./routeTileQueries";

/** One admin notes tile as MVT bytes; an empty buffer is an empty tile. */
export async function adminNotesTile(z: number, x: number, y: number): Promise<Buffer> {
  const result = await tilePool.query<{ tile: Buffer | null }>(
    "SELECT admin_notes_tile($1, $2, $3) AS tile",
    [z, x, y],
  );
  return result.rows[0]?.tile ?? Buffer.alloc(0);
}
