/**
 * User preference reads and writes, taking the user id explicitly.
 *
 * Plain module, not "use server" — same reasoning as `progressQueries.ts`: the
 * user id is an argument, so exposing these as endpoints would let anyone read
 * or overwrite anyone's settings. `userPreferencesActions.ts` resolves the
 * session and calls in; the mobile API's handler resolves a bearer token and
 * calls the same functions.
 */

import { query } from "./db";
import { normalizeCountryCodes, SUPPORTED_COUNTRIES } from "./shared/constants";

/**
 * The user's country filter, creating the default row on first read.
 *
 * The default is written explicitly rather than left to the column's SQL
 * DEFAULT, so a row inserted here always carries the full list.
 *
 * One upsert rather than a SELECT and then an INSERT, as in
 * `getPublicMapSettings`: two concurrent first reads for the same user raced on
 * the primary key, and the loser's unique violation surfaced as a hard read
 * failure. `DO UPDATE` with a self-assignment keeps whatever is already stored
 * while still letting `RETURNING` answer on the conflict path, which `DO
 * NOTHING` would not.
 */
export async function selectedCountriesForUser(userId: number): Promise<string[]> {
  try {
    const result = await query(
      `INSERT INTO user_preferences (user_id, selected_countries)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET selected_countries = user_preferences.selected_countries
       RETURNING selected_countries`,
      [userId, SUPPORTED_COUNTRIES.map((c) => c.code)],
    );

    return result.rows[0].selected_countries;
  } catch (error) {
    console.error("Error fetching user preferences:", error);
    throw new Error("Failed to fetch user preferences");
  }
}

/**
 * Replace the user's country filter, returning the list as it was stored.
 *
 * The codes are normalized here rather than at either caller, because both
 * transports write through this one function and the column would otherwise
 * hold whatever each of them happened to check: the HTTP handler shape-checks a
 * JSON array and the server action is an ordinary POST that takes its argument
 * as given. Same treatment the filter already gets when it is read off a query
 * string (`optionalCountries`), so a code that survives a write is one a read
 * would have kept. Dropping the malformed rather than refusing the call also
 * bounds the array: two-letter codes, deduplicated, cannot exceed 676 entries.
 *
 * The stored list is returned so a caller can echo what it actually saved
 * instead of what it was handed.
 */
export async function updateSelectedCountriesForUser(
  userId: number,
  selectedCountries: string[],
): Promise<string[]> {
  const codes = normalizeCountryCodes(selectedCountries);

  try {
    await query(
      `INSERT INTO user_preferences (user_id, selected_countries, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET selected_countries = $2, updated_at = NOW()`,
      [userId, codes],
    );
    return codes;
  } catch (error) {
    console.error("Error updating user preferences:", error);
    throw new Error("Failed to update user preferences");
  }
}
