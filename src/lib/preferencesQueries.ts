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
 */
export async function selectedCountriesForUser(userId: number): Promise<string[]> {
  try {
    const result = await query(
      "SELECT selected_countries FROM user_preferences WHERE user_id = $1",
      [userId],
    );

    if (result.rows.length > 0) {
      return result.rows[0].selected_countries;
    }

    const defaultCountries = SUPPORTED_COUNTRIES.map((c) => c.code);
    await query("INSERT INTO user_preferences (user_id, selected_countries) VALUES ($1, $2)", [
      userId,
      defaultCountries,
    ]);

    return defaultCountries;
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
