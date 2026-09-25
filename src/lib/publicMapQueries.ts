/**
 * Resolving a share token to the map's owner.
 *
 * A plain server-only module rather than part of `publicMapActions.ts`, for two
 * reasons. The route tile handler (`src/app/api/tiles`) needs it, and a route
 * handler never imports a "use server" module. And every export of one is a
 * client-callable endpoint: exported from there, this would hand any holder of
 * a link the owner's user id and country filter as a remote call of its own,
 * where the shared page only ever needed it server-side.
 */

import { query } from "./db";

/** The owner of a shared map, as resolved from a token. */
export interface PublicMapOwner {
  userId: number;
  /** Display name, falling back to the part of the email before the @. */
  displayName: string;
  /** The owner's country filter — the public view is shown exactly as they see it. */
  selectedCountries: string[];
}

/**
 * Whether a string can be a share token at all. Anything else is refused before
 * it reaches the database.
 */
export function isPlausibleShareToken(token: string): boolean {
  return token.length > 0 && token.length <= 64;
}

/**
 * The share rule as SQL: the id of the user whose share token is in `param`,
 * and NULL unless sharing is switched on.
 *
 * Every public read goes through it — `publicMapOwner` below, and the shared
 * map's route tiles (`routeTileQueries.ts`), which embed it in the tile query so
 * a tile costs one round trip on the tile pool rather than a token lookup on the
 * app's pool first. So "sharing switched off" is written in exactly one place,
 * and checked on every call rather than once per page load.
 */
export function sharedMapOwnerIdSql(param: string): string {
  return `(SELECT user_id FROM user_preferences
           WHERE public_map_token = ${param} AND public_map_enabled = TRUE)`;
}

/** The owner of a shared map, or null if the token is unknown or sharing is off. */
export async function publicMapOwner(token: string): Promise<PublicMapOwner | null> {
  if (!isPlausibleShareToken(token)) return null;

  const result = await query(
    `SELECT up.user_id, up.selected_countries, u.name, u.email
     FROM user_preferences up
     JOIN users u ON u.id = up.user_id
     WHERE up.user_id = ${sharedMapOwnerIdSql("$1")}`,
    [token],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    userId: row.user_id,
    displayName: row.name || String(row.email).split("@")[0],
    selectedCountries: row.selected_countries,
  };
}
