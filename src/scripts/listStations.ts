#!/usr/bin/env tsx

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function listStations() {
  const client = await pool.connect();

  try {
    console.log('Fetching unique station names from railway_routes...\n');

    // Query to get all unique station names from both from_station and to_station
    // UNION automatically removes duplicates
    const result = await client.query<{ station_name: string }>(`
      SELECT from_station AS station_name FROM railway_routes
      UNION
      SELECT to_station AS station_name FROM railway_routes
      ORDER BY station_name
    `);

    console.log(`Found ${result.rows.length} unique stations:\n`);
    console.log('─'.repeat(60));

    result.rows.forEach((row, index) => {
      console.log(`${(index + 1).toString().padStart(4, ' ')}. ${row.station_name}`);
    });

    console.log('─'.repeat(60));
    console.log(`\nTotal: ${result.rows.length} unique stations`);

  } catch (error) {
    console.error('Error fetching stations:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the script
listStations().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
