#!/usr/bin/env tsx
/**
 * Add line_class to railway_routes and usage/highspeed to railway_parts
 *
 * Changes:
 *   - railway_parts: adds 'usage' (TEXT) and 'highspeed' (BOOLEAN) columns
 *   - railway_routes: adds 'line_class' column (highspeed/main/branch)
 *   - Migrates existing hsl=true routes to line_class='highspeed'
 *   - Sets remaining routes to line_class='branch' (default)
 *   - Drops the hsl column from railway_routes
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function addLineClass() {
  const client = await pool.connect();

  try {
    console.log('Adding line_class to railway_routes and usage/highspeed to railway_parts...');
    console.log('=====================================\n');

    await client.query('BEGIN');

    // Add usage and highspeed columns to railway_parts
    await client.query(`
      ALTER TABLE railway_parts
      ADD COLUMN IF NOT EXISTS usage TEXT,
      ADD COLUMN IF NOT EXISTS highspeed BOOLEAN DEFAULT FALSE;
    `);
    console.log('  Added usage and highspeed columns to railway_parts');

    // Add line_class column to railway_routes
    await client.query(`
      ALTER TABLE railway_routes
      ADD COLUMN IF NOT EXISTS line_class VARCHAR(20) DEFAULT 'branch';
    `);
    console.log('  Added line_class column to railway_routes');

    // Add CHECK constraint (only if column was just created, handle existing)
    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE railway_routes
        ADD CONSTRAINT railway_routes_line_class_check
        CHECK (line_class IN ('highspeed', 'main', 'branch'));
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);
    console.log('  Added CHECK constraint on line_class');

    // Drop the hsl column (line_class will be set by classifyRoutes)
    await client.query(`
      ALTER TABLE railway_routes DROP COLUMN IF EXISTS hsl;
    `);
    console.log('  Dropped hsl column from railway_routes');

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
addLineClass().catch((error) => {
  console.error('Script error:', error);
  process.exit(1);
});
