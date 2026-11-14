/**
 * Resolving a share token to the map's owner, and the shared map's reads.
 *
 * A plain server-only module rather than part of `publicMapActions.ts`, for two
 * reasons. The route handlers need it (the route tile and the `api/shared`
 * reads), and a route handler never imports a "use server" module. And every
 * export of one is a client-callable endpoint: exported from there,
 * `publicMapOwner` would hand any holder of a link the owner's user id and
 * country filter as a remote call of its own, where the shared page only ever
 * needed it server-side.
 *
 * The reads at the bottom resolve the token on every call, so a link switched
 * off mid-visit stops answering at once.
 */
import pool from "./db";
import { NotFoundError } from "./errors";
import {
  coveredStretchesForUser,
  progressByCountryForUser,
  progressForUser,
} from "./progressQueries";
import type { ProgressByCountry, UserProgress } from "./shared/progress";
import type { RegionId } from "./shared/regions";
import type { CoveredStretch } from "./shared/types";

/** The owner of a shared map, as resolved from a token. */
interface PublicMapOwner {
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

  const result = await pool.query<{
    user_id: number;
    selected_countries: string[];
    name: string | null;
    email: string;
  }>(
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
    displayName: row.name || row.email.split("@")[0],
    selectedCountries: row.selected_countries,
  };
}

/** A shared map's refusal once its link is dead. */
const SHARED_MAP_GONE_MESSAGE = "This map is no longer shared.";

/**
 * The id of a shared map's owner, for the reads below: one indexed lookup, none
 * of `publicMapOwner`'s join. A dead link (unknown token, or sharing switched
 * off, perhaps since the page loaded) is a `NotFoundError`, never an empty
 * answer: as with the route tile, zeros would pass for a map with nothing
 * ridden, where the visitor should see that the map stopped answering.
 *
 * The token is resolved in its own query. Folding `sharedMapOwnerIdSql` into the
 * progress query was measured (2026-11-14) to cost the query about what the
 * lookup costs, so it saves nothing.
 */
async function sharedMapOwnerId(token: string): Promise<number> {
  const result = isPlausibleShareToken(token)
    ? await pool.query<{ user_id: number | null }>(
        `SELECT ${sharedMapOwnerIdSql("$1")} AS user_id`,
        [token],
      )
    : null;

  const userId = result?.rows[0]?.user_id ?? null;
  if (userId === null) throw new NotFoundError(SHARED_MAP_GONE_MESSAGE);
  return userId;
}

/** Progress figures for a shared map. */
export async function sharedMapProgress(
  token: string,
  region: RegionId,
  selectedCountries?: string[],
  shownUsageTypes?: number[],
): Promise<UserProgress> {
  const ownerId = await sharedMapOwnerId(token);
  return progressForUser(ownerId, region, selectedCountries, shownUsageTypes);
}

/** Per-country progress for a shared map. */
export async function sharedMapProgressByCountry(
  token: string,
  region: RegionId,
): Promise<ProgressByCountry> {
  const ownerId = await sharedMapOwnerId(token);
  return progressByCountryForUser(ownerId, region);
}

/** Ridden stretches of unfinished routes, for the shared map's overlay. */
export async function sharedMapCoveredStretches(
  token: string,
  region: RegionId,
): Promise<CoveredStretch[]> {
  const ownerId = await sharedMapOwnerId(token);
  return coveredStretchesForUser(ownerId, region);
}
