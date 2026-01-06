'use server';

import { query } from './db';
import { getUser } from './authActions';
import type { UserPreferences } from './types';
import { SUPPORTED_COUNTRIES } from './constants';

/**
 * Get user preferences (selected countries for filtering)
 * Creates default preferences if they don't exist
 */
export async function getUserPreferences(): Promise<string[]> {
  const user = await getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  try {
    // Try to fetch existing preferences
    const result = await query(
      'SELECT selected_countries FROM user_preferences WHERE user_id = $1',
      [user.id]
    );

    if (result.rows.length > 0) {
      return result.rows[0].selected_countries;
    }

    // No preferences found, create default preferences
    const defaultCountries = SUPPORTED_COUNTRIES.map(c => c.code);
    await query(
      'INSERT INTO user_preferences (user_id, selected_countries) VALUES ($1, $2)',
      [user.id, defaultCountries]
    );

    return defaultCountries;
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    throw new Error('Failed to fetch user preferences');
  }
}

/**
 * Update user preferences (selected countries for filtering)
 */
export async function updateUserPreferences(selectedCountries: string[]): Promise<void> {
  const user = await getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  try {
    // Use INSERT ... ON CONFLICT to handle both insert and update cases
    await query(
      `INSERT INTO user_preferences (user_id, selected_countries, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET selected_countries = $2, updated_at = NOW()`,
      [user.id, selectedCountries]
    );
  } catch (error) {
    console.error('Error updating user preferences:', error);
    throw new Error('Failed to update user preferences');
  }
}
