#!/usr/bin/env tsx
/**
 * Migrate to journey-based system
 *
 * This script:
 * 1. Drops the old user_trips table
 * 2. Creates user_journeys table (named trips with dates)
 * 3. Creates user_logged_parts table (journey-route connections)
 * 4. Creates necessary indexes and triggers
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function migrateToJourneys() {
  const client = await pool.connect();

  try {
    console.log('Migrating to journey-based system...');
    console.log('=====================================\n');

    // Drop old user_trips table if it exists
    console.log('Dropping old user_trips table...');
    await client.query('DROP TABLE IF EXISTS user_trips CASCADE');
    console.log('✓ Dropped user_trips table\n');

    // Create user_journeys table
    console.log('Creating user_journeys table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_journeys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (name != ''),
        description TEXT,
        date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Created user_journeys table\n');

    // Create user_logged_parts table
    console.log('Creating user_logged_parts table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_logged_parts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        journey_id INTEGER NOT NULL REFERENCES user_journeys(id) ON DELETE CASCADE,
        track_id INTEGER REFERENCES railway_routes(track_id) ON DELETE SET NULL,
        partial BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✓ Created user_logged_parts table\n');

    // Create indexes for user_journeys
    console.log('Creating indexes for user_journeys...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_journeys_user_id ON user_journeys (user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_journeys_date ON user_journeys (date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_journeys_user_date ON user_journeys (user_id, date DESC)
    `);
    console.log('✓ Created user_journeys indexes\n');

    // Create indexes for user_logged_parts
    console.log('Creating indexes for user_logged_parts...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logged_parts_user_id ON user_logged_parts (user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logged_parts_journey_id ON user_logged_parts (journey_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logged_parts_track_id ON user_logged_parts (track_id)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_logged_parts_unique ON user_logged_parts (journey_id, track_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logged_parts_user_track_partial ON user_logged_parts (user_id, track_id, partial)
    `);
    console.log('✓ Created user_logged_parts indexes\n');

    // Create or replace update_timestamp trigger function if not exists
    console.log('Ensuring update_timestamp function exists...');
    await client.query(`
      CREATE OR REPLACE FUNCTION update_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    console.log('✓ Update timestamp function ready\n');

    // Create trigger for user_journeys
    console.log('Creating trigger for user_journeys...');
    await client.query(`
      DROP TRIGGER IF EXISTS user_journeys_update_timestamp ON user_journeys
    `);
    await client.query(`
      CREATE TRIGGER user_journeys_update_timestamp
      BEFORE UPDATE ON user_journeys
      FOR EACH ROW
      EXECUTE FUNCTION update_timestamp()
    `);
    console.log('✓ Created user_journeys trigger\n');

    console.log('=====================================');
    console.log('Migration completed successfully!');
    console.log('=====================================\n');
    console.log('New tables created:');
    console.log('  - user_journeys (named trips with dates)');
    console.log('  - user_logged_parts (journey-route connections)');
    console.log('\nOld table dropped:');
    console.log('  - user_trips\n');

  } catch (error) {
    console.error('Error during migration:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
migrateToJourneys().catch((error) => {
  console.error('Script error:', error);
  process.exit(1);
});
