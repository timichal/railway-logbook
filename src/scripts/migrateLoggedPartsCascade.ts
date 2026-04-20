#!/usr/bin/env tsx
/**
 * Migration: change user_logged_parts.track_id FK to ON DELETE CASCADE
 *
 * Previously the FK used ON DELETE SET NULL to preserve journey history.
 * Now, when a railway_route is deleted, its logged parts are removed from
 * every journey automatically.
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

dotenv.config();

const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Migrating user_logged_parts.track_id FK to ON DELETE CASCADE...');
    console.log('=====================================\n');

    // Clean up orphaned rows from the old ON DELETE SET NULL era:
    // logged parts whose track_id is NULL (route was already deleted).
    const orphanResult = await client.query(`
      DELETE FROM user_logged_parts
      WHERE track_id IS NULL
      RETURNING id, journey_id;
    `);
    console.log(`✓ Removed ${orphanResult.rowCount} orphaned logged parts (track_id IS NULL)\n`);

    // Find the existing FK constraint name on track_id
    const constraintResult = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'user_logged_parts'::regclass
        AND contype = 'f'
        AND conkey = (
          SELECT ARRAY[attnum]
          FROM pg_attribute
          WHERE attrelid = 'user_logged_parts'::regclass
            AND attname = 'track_id'
        );
    `);

    if (constraintResult.rowCount === 0) {
      console.log('No FK constraint found on user_logged_parts.track_id — adding a new one.');
    } else {
      for (const row of constraintResult.rows) {
        console.log(`Dropping existing constraint: ${row.conname}`);
        await client.query(`ALTER TABLE user_logged_parts DROP CONSTRAINT ${row.conname};`);
      }
    }

    console.log('Adding new FK with ON DELETE CASCADE...');
    await client.query(`
      ALTER TABLE user_logged_parts
      ADD CONSTRAINT user_logged_parts_track_id_fkey
      FOREIGN KEY (track_id)
      REFERENCES railway_routes(track_id)
      ON DELETE CASCADE;
    `);

    console.log('\n=====================================');
    console.log('Migration complete!');
    console.log('=====================================\n');
  } catch (error) {
    console.error('Error during migration:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('Script error:', error);
  process.exit(1);
});
