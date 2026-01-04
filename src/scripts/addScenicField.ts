#!/usr/bin/env tsx
/**
 * Add scenic field to railway_routes table
 *
 * This script adds a scenic BOOLEAN field to the railway_routes table
 * and sets the default value to FALSE for all existing routes.
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function addScenicField() {
  const client = await pool.connect();

  try {
    console.log('Adding scenic field to railway_routes table...');
    console.log('=====================================\n');

    // Add the scenic column if it doesn't exist
    await client.query(`
      ALTER TABLE railway_routes
      ADD COLUMN IF NOT EXISTS scenic BOOLEAN DEFAULT FALSE;
    `);

    console.log('✓ Added scenic column to railway_routes table');

    // Update existing routes to have scenic=FALSE (default)
    const result = await client.query(`
      UPDATE railway_routes
      SET scenic = FALSE
      WHERE scenic IS NULL;
    `);

    console.log(`✓ Updated ${result.rowCount} existing routes to scenic=FALSE\n`);

    console.log('=====================================');
    console.log('Scenic field added successfully!');
    console.log('=====================================\n');

  } catch (error) {
    console.error('Error adding scenic field:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
addScenicField().catch((error) => {
  console.error('Script error:', error);
  process.exit(1);
});
