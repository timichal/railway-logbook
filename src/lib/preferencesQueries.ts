/**
 * User preference reads and writes, taking the user id explicitly.
 *
 * Plain module, not "use server" — same reasoning as `progressQueries.ts`: the
 * user id is an argument, so exposing these as endpoints would let anyone read
 * or overwrite anyone's settings. `userPreferencesActions.ts` resolves the
 * session and calls in; the mobile API's handler resolves a bearer token and
 * calls the same functions.
 */

import { SUPPORTED_COUNTRIES } from "./constants";
import { query } from "./db";

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

export async function updateSelectedCountriesForUser(
  userId: number,
  selectedCountries: string[],
): Promise<void> {
  try {
    await query(
      `INSERT INTO user_preferences (user_id, selected_countries, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET selected_countries = $2, updated_at = NOW()`,
      [userId, selectedCountries],
    );
  } catch (error) {
    console.error("Error updating user preferences:", error);
    throw new Error("Failed to update user preferences");
  }
}
