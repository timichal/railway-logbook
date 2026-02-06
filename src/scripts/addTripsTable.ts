#!/usr/bin/env tsx
/**
 * Add user_trips table and trip_id FK to user_journeys
 *
 * Creates:
 *   - user_trips table (id, user_id, name, description, created_at, updated_at)
 *   - user_journeys.trip_id column (nullable FK to user_trips)
 *   - Indexes on user_trips(user_id) and user_journeys(trip_id)
 *   - updated_at trigger on user_trips
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function addTripsTable() {
  const client = await pool.connect();

  try {
    console.log('Adding user_trips table and trip_id to user_journeys...');
    console.log('=====================================\n');

    await client.query('BEGIN');

    // Create user_trips table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_trips (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (name != ''),
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('  Created user_trips table');

    // Add trip_id column to user_journeys (nullable FK, ON DELETE SET NULL)
    await client.query(`
      ALTER TABLE user_journeys
      ADD COLUMN IF NOT EXISTS trip_id INTEGER REFERENCES user_trips(id) ON DELETE SET NULL;
    `);
    console.log('  Added trip_id column to user_journeys');

    // Create indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_trips_user_id ON user_trips (user_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_journeys_trip_id ON user_journeys (trip_id);
    `);
    console.log('  Created indexes');

    // Create updated_at trigger for user_trips
    await client.query(`
      CREATE TRIGGER user_trips_update_timestamp
      BEFORE UPDATE ON user_trips
      FOR EACH ROW
      EXECUTE FUNCTION update_timestamp();
    `);
    console.log('  Created updated_at trigger for user_trips');

    await client.query('COMMIT');

    console.log('\n=====================================');
    console.log('Migration complete!');
    console.log('=====================================\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error running migration:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
addTripsTable().catch((error) => {
  console.error('Script error:', error);
  process.exit(1);
});
