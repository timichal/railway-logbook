'use server';

import { query } from './db';
import { getUser } from './authActions';

export interface MigrationResult {
  migrated: number;
  skipped: number;
}

export interface JourneyMigrationResult {
  journeysMigrated: number;
  journeysSkipped: number;
  partsMigrated: number;
  partsSkipped: number;
}

/**
 * Migrates localStorage journeys to the database for a logged-in user
 * Creates journeys and their logged parts in the database
 */
export async function migrateLocalJourneys(
  localJourneys: { id: string; name: string; description: string | null; date: string }[],
  localParts: { journey_id: string; track_id: number; partial: boolean }[]
): Promise<JourneyMigrationResult> {
  const user = await getUser();

  if (!user) {
    throw new Error('You must be logged in to migrate journeys');
  }

  let journeysMigrated = 0;
  let journeysSkipped = 0;
  let partsMigrated = 0;
  let partsSkipped = 0;

  // Map local journey IDs to database journey IDs
  const journeyIdMap = new Map<string, number>();

  for (const localJourney of localJourneys) {
    try {
      // Check for duplicate journey (same name and date)
      const duplicateCheck = await query(
        `SELECT id FROM user_journeys
         WHERE user_id = $1
         AND name = $2
         AND date = $3`,
        [user.id, localJourney.name, localJourney.date]
      );

      if (duplicateCheck.rows.length === 0) {
        // Not a duplicate, insert it
        const result = await query(
          `INSERT INTO user_journeys (user_id, name, description, date)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [user.id, localJourney.name, localJourney.description, localJourney.date]
        );

        const newJourneyId = result.rows[0].id;
        journeyIdMap.set(localJourney.id, newJourneyId);
        journeysMigrated++;
      } else {
        // Journey already exists, map to existing ID
        journeyIdMap.set(localJourney.id, duplicateCheck.rows[0].id);
        journeysSkipped++;
      }
    } catch (error) {
      console.error('Error migrating journey:', error);
      journeysSkipped++;
    }
  }

  // Now migrate the logged parts
  for (const localPart of localParts) {
    try {
      const dbJourneyId = journeyIdMap.get(localPart.journey_id);

      if (!dbJourneyId) {
        // Journey wasn't migrated, skip this part
        partsSkipped++;
        continue;
      }

      // Check for duplicate logged part (same journey_id and track_id)
      const duplicateCheck = await query(
        `SELECT id FROM user_logged_parts
         WHERE user_id = $1
         AND journey_id = $2
         AND track_id = $3`,
        [user.id, dbJourneyId, localPart.track_id]
      );

      if (duplicateCheck.rows.length === 0) {
        // Not a duplicate, insert it
        await query(
          `INSERT INTO user_logged_parts (user_id, journey_id, track_id, partial)
           VALUES ($1, $2, $3, $4)`,
          [user.id, dbJourneyId, localPart.track_id, localPart.partial]
        );
        partsMigrated++;
      } else {
        partsSkipped++;
      }
    } catch (error) {
      console.error('Error migrating logged part:', error);
      partsSkipped++;
    }
  }

  return {
    journeysMigrated,
    journeysSkipped,
    partsMigrated,
    partsSkipped,
  };
}
