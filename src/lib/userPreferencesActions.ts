"use server";

import { getUser } from "./authActions";
import { updateSelectedCountriesForUser } from "./preferencesQueries";

/**
 * Update user preferences (selected countries for filtering).
 */
export async function updateUserPreferences(selectedCountries: string[]): Promise<void> {
  const user = await getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  await updateSelectedCountriesForUser(user.id, selectedCountries);
}
