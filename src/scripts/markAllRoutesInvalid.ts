#!/usr/bin/env tsx
/**
 * Mark all routes as invalid for rechecking
 *
 * This script sets is_valid=false and error_message='Route recheck'
 * for all routes in the database.
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function markAllRoutesInvalid() {
  const client = await pool.connect();

  try {
    console.log('Marking all routes as invalid for rechecking...');
    console.log('=====================================\n');

    const result = await client.query(`
      UPDATE railway_routes
      SET is_valid = FALSE,
          error_message = 'Route recheck',
          updated_at = CURRENT_TIMESTAMP
      WHERE (is_valid = TRUE OR error_message IS NULL OR error_message != 'Route recheck')
      AND (from_station LIKE '%junction%' OR to_station LIKE '%junction%')
      RETURNING track_id, from_station, to_station;
    `);

    console.log(`✓ Marked ${result.rowCount} routes as invalid\n`);

    if (result.rowCount! > 0) {
      console.log('Updated routes:');
      result.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. Track ${row.track_id}: ${row.from_station} ⟷ ${row.to_station}`);
      });
    }

    console.log('\n=====================================');
    console.log('All routes marked for rechecking!');
    console.log('=====================================\n');

  } catch (error) {
    console.error('Error marking routes as invalid:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
markAllRoutesInvalid().catch((error) => {
  console.error('Script error:', error);
  process.exit(1);
});
