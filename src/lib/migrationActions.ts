'use server';

import { query } from './db';
import { getUser } from './authActions';

export interface MigrationResult {
  migrated: number;
  skipped: number;
}

/**
 * Migrates localStorage trips to the database for a logged-in user
 * Skips exact duplicates (same track_id, date, note, partial)
 */
export async function migrateLocalTrips(
  localTrips: { track_id: string; date: string; note: string | null; partial: boolean }[]
): Promise<MigrationResult> {
  const user = await getUser();

  if (!user) {
    throw new Error('You must be logged in to migrate trips');
  }

  let migratedCount = 0;
  let skippedCount = 0;

  for (const trip of localTrips) {
    try {
      // Check for exact duplicate (same track_id, date, note, partial)
      const duplicateCheck = await query(
        `SELECT id FROM user_trips
         WHERE user_id = $1
         AND track_id = $2
         AND date = $3
         AND (note = $4 OR (note IS NULL AND $4 IS NULL))
         AND partial = $5`,
        [user.id, parseInt(trip.track_id), trip.date, trip.note, trip.partial]
      );

      if (duplicateCheck.rows.length === 0) {
        // Not a duplicate, insert it
        await query(
          'INSERT INTO user_trips (user_id, track_id, date, note, partial) VALUES ($1, $2, $3, $4, $5)',
          [user.id, parseInt(trip.track_id), trip.date, trip.note, trip.partial]
        );
        migratedCount++;
      } else {
        skippedCount++;
      }
    } catch (error) {
      console.error('Error migrating trip:', error);
      // Continue with other trips even if one fails
      skippedCount++;
    }
  }

  return { migrated: migratedCount, skipped: skippedCount };
}
