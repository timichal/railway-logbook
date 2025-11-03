/**
 * Database Migration: November 2025
 *
 * Changes:
 * 1. railway_routes.usage_type: Change from 3 values (Regular=0, Seasonal=1, Special=2)
 *    to 2 values (Regular=0, Special=1), add frequency tags array
 * 2. user_railway_data: Move to user_trips table to support multiple trips per route
 * 3. Update vector tile functions to use new schema
 *
 * Run with: npx tsx src/scripts/migrate-schema-2025-01.ts
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/db-config';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

console.log('Database connection config:');
console.log(`  Host: ${dbConfig.host}`);
console.log(`  Port: ${dbConfig.port}`);
console.log(`  Database: ${dbConfig.database}`);
console.log(`  User: ${dbConfig.user}`);
console.log(`  Password: ${dbConfig.password ? '***' : 'NOT SET'}\n`);

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Starting database migration...\n');

    // Start transaction
    await client.query('BEGIN');

    // ========================================================================
    // PART 1: Migrate railway_routes usage_type and add frequency
    // ========================================================================

    console.log('1. Adding frequency column to railway_routes...');
    await client.query(`
      ALTER TABLE railway_routes
      ADD COLUMN IF NOT EXISTS frequency TEXT[] DEFAULT ARRAY[]::TEXT[]
    `);
    console.log('   ✓ Added frequency column\n');

    console.log('2. Migrating Seasonal routes (usage_type=1)...');
    // Find routes with usage_type=1 (Seasonal) and add 'Seasonal' to frequency, change to Regular
    const seasonalResult = await client.query(`
      UPDATE railway_routes
      SET
        frequency = ARRAY['Seasonal']::TEXT[],
        usage_type = 0
      WHERE usage_type = 1
      RETURNING track_id, from_station, to_station
    `);
    console.log(`   ✓ Migrated ${seasonalResult.rowCount} seasonal routes to Regular with Seasonal frequency\n`);

    console.log('3. Updating Special routes (usage_type=2 -> 1)...');
    // Update Special routes from 2 to 1
    const specialResult = await client.query(`
      UPDATE railway_routes
      SET usage_type = 1
      WHERE usage_type = 2
      RETURNING track_id, from_station, to_station
    `);
    console.log(`   ✓ Updated ${specialResult.rowCount} special routes (usage_type 2 -> 1)\n`);

    // ========================================================================
    // PART 2: Create user_trips table and migrate data
    // ========================================================================

    console.log('4. Creating user_trips table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_trips (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        track_id INTEGER NOT NULL REFERENCES railway_routes(track_id) ON DELETE CASCADE,
        date DATE, -- Date of trip (can be null for unlogged routes)
        note TEXT, -- User note
        partial BOOLEAN DEFAULT FALSE, -- Partial completion flag
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✓ Created user_trips table\n');

    console.log('5. Creating indexes for user_trips...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_trips_user_id ON user_trips (user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_trips_track_id ON user_trips (track_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_trips_date ON user_trips (date)
    `);
    console.log('   ✓ Created indexes\n');

    console.log('6. Migrating data from user_railway_data to user_trips...');
    const migrateResult = await client.query(`
      INSERT INTO user_trips (user_id, track_id, date, note, partial, created_at, updated_at)
      SELECT user_id, track_id, date, note, partial, created_at, updated_at
      FROM user_railway_data
      RETURNING id
    `);
    console.log(`   ✓ Migrated ${migrateResult.rowCount} trip records\n`);

    console.log('7. Dropping old user_railway_data table...');
    await client.query(`DROP TABLE IF EXISTS user_railway_data`);
    console.log('   ✓ Dropped user_railway_data table\n');

    // ========================================================================
    // PART 3: Update vector tile functions
    // ========================================================================

    console.log('8. Updating railway_routes_tile function...');

    // Read the updated vector tiles SQL
    const vectorTilesSql = fs.readFileSync(
      path.join(process.cwd(), 'database/init/02-vector-tiles.sql'),
      'utf-8'
    );

    // Execute only the railway_routes_tile function (the one we changed)
    // Extract just the railway_routes_tile function from the SQL file
    const functionMatch = vectorTilesSql.match(
      /CREATE OR REPLACE FUNCTION railway_routes_tile[\s\S]*?PARALLEL SAFE;/
    );

    if (functionMatch) {
      await client.query(functionMatch[0]);
      console.log('   ✓ Updated railway_routes_tile function to use user_trips\n');
    } else {
      console.warn('   ⚠ Could not find railway_routes_tile function in SQL file\n');
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log('✅ Migration completed successfully!\n');
    console.log('Summary:');
    console.log(`  - Migrated ${seasonalResult.rowCount} seasonal routes`);
    console.log(`  - Updated ${specialResult.rowCount} special routes`);
    console.log(`  - Migrated ${migrateResult.rowCount} trip records to new table`);
    console.log('  - Updated vector tile function to use new schema');
    console.log('\nNew schema:');
    console.log('  - railway_routes.usage_type: 0=Regular, 1=Special');
    console.log('  - railway_routes.frequency: Array of tags (Daily, Weekdays, Weekends, Once a week, Seasonal)');
    console.log('  - user_trips: Replaces user_railway_data, supports multiple trips per route');

  } catch (error) {
    // Rollback on error
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
migrate().catch((error) => {
  console.error('Migration error:', error);
  process.exit(1);
});
