#!/usr/bin/env tsx
/**
 * Migration script to add has_backtracking column to railway_routes
 *
 * Adds a boolean column set by the verification script:
 * - has_backtracking (boolean, defaults to FALSE)
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function addHasBacktracking() {
  const client = await pool.connect();

  try {
    console.log('Adding has_backtracking column to railway_routes...');
    console.log('=====================================\n');

    // Check if column already exists
    const checkColumn = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'railway_routes'
        AND column_name = 'has_backtracking'
      );
    `);

    if (checkColumn.rows[0].exists) {
      console.log('✓ has_backtracking column already exists, skipping creation\n');
      return;
    }

    // Add has_backtracking column
    await client.query(`
      ALTER TABLE railway_routes
      ADD COLUMN has_backtracking BOOLEAN DEFAULT FALSE;
    `);

    console.log('✓ Added has_backtracking column to railway_routes');

    // Update existing data to set has_backtracking=FALSE (default)
    console.log('✓ All existing routes set to has_backtracking=FALSE (default)');

    console.log('\n=====================================');
    console.log('Migration completed successfully!');
    console.log('Run "npm run verifyRouteData" to populate has_backtracking values');
    console.log('=====================================\n');

  } catch (error) {
    console.error('Error during migration:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
addHasBacktracking().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
