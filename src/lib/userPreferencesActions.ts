"use server";

import { getUser } from "./authActions";
import { selectedCountriesForUser, updateSelectedCountriesForUser } from "./preferencesQueries";

/**
 * Get user preferences (selected countries for filtering).
 * Creates default preferences if they don't exist.
 */
export async function getUserPreferences(): Promise<string[]> {
  const user = await getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  return selectedCountriesForUser(user.id);
}

/**
 * Update user preferences (selected countries for filtering).
 */
export async function updateUserPreferences(selectedCountries: string[]): Promise<void> {
  const user = await getUser();

  if (!user) {
    throw new Error("User not authenticated");
  }

  return updateSelectedCountriesForUser(user.id, selectedCountries);
}
