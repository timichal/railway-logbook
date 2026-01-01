#!/usr/bin/env tsx
/**
 * Migration script to add intended_backtracking column to railway_routes
 *
 * Adds a boolean column to indicate when backtracking is intentional:
 * - intended_backtracking (boolean, defaults to FALSE)
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function addIntendedBacktracking() {
  const client = await pool.connect();

  try {
    console.log('Adding intended_backtracking column to railway_routes...');
    console.log('=====================================\n');

    // Check if column already exists
    const checkColumn = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'railway_routes'
        AND column_name = 'intended_backtracking'
      );
    `);

    if (checkColumn.rows[0].exists) {
      console.log('✓ intended_backtracking column already exists, skipping creation\n');
      return;
    }

    // Add intended_backtracking column
    await client.query(`
      ALTER TABLE railway_routes
      ADD COLUMN intended_backtracking BOOLEAN DEFAULT FALSE;
    `);

    console.log('✓ Added intended_backtracking column to railway_routes');

    // Update existing data to set intended_backtracking=FALSE (default)
    console.log('✓ All existing routes set to intended_backtracking=FALSE (default)');

    console.log('\n=====================================');
    console.log('Migration completed successfully!');
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
addIntendedBacktracking().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
