#!/usr/bin/env tsx
/**
 * Add hsl field to railway_routes table
 *
 * This script adds the hsl (high-speed line) boolean column
 * to the railway_routes table with default value FALSE.
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function addHslField() {
  const client = await pool.connect();

  try {
    console.log('Adding hsl field to railway_routes table...');
    console.log('=========================================\n');

    // Check if the column already exists
    const checkResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'railway_routes'
        AND column_name = 'hsl'
    `);

    if (checkResult.rows.length > 0) {
      console.log('⚠ hsl column already exists in railway_routes table');
      console.log('\n=========================================');
      console.log('Migration skipped (already applied)');
      console.log('=========================================\n');
      return;
    }

    // Add the column
    await client.query(`
      ALTER TABLE railway_routes
      ADD COLUMN hsl BOOLEAN DEFAULT FALSE;
    `);

    console.log('✓ Added hsl column to railway_routes table\n');

    // Get count of routes
    const countResult = await client.query(`
      SELECT COUNT(*) as count FROM railway_routes
    `);

    console.log(`All ${countResult.rows[0].count} routes now have hsl field (default: FALSE)\n`);

    console.log('=========================================');
    console.log('Migration completed successfully!');
    console.log('=========================================\n');

  } catch (error) {
    console.error('Error adding hsl field:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
addHslField().catch((error) => {
  console.error('Script error:', error);
  process.exit(1);
});
