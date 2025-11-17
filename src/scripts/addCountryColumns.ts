/**
 * Migration script to add country columns to railway_routes table
 * and create user_preferences table
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
import { getDbConfig } from '../lib/dbConfig';
import { getRouteCountries } from '../lib/countryUtils';

dotenv.config();

// Get database config after dotenv loads environment variables
const dbConfig = getDbConfig();

async function runMigration(): Promise<void> {
  const client = new Client(dbConfig);

  try {
    await client.connect();
    console.log('Connected to database');

    // Step 1: Add country columns to railway_routes table
    console.log('\n=== Step 1: Adding country columns to railway_routes ===');

    try {
      await client.query(`
        ALTER TABLE railway_routes
        ADD COLUMN IF NOT EXISTS start_country VARCHAR(2),
        ADD COLUMN IF NOT EXISTS end_country VARCHAR(2)
      `);
      console.log('✓ Country columns added successfully');
    } catch (error) {
      console.error('Error adding country columns:', error);
      throw error;
    }

    // Step 2: Create indexes for country columns
    console.log('\n=== Step 2: Creating indexes for country columns ===');

    try {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_railway_routes_start_country
        ON railway_routes (start_country)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_railway_routes_end_country
        ON railway_routes (end_country)
      `);
      console.log('✓ Indexes created successfully');
    } catch (error) {
      console.error('Error creating indexes:', error);
      throw error;
    }

    // Step 3: Create user_preferences table
    console.log('\n=== Step 3: Creating user_preferences table ===');

    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          selected_countries TEXT[] NOT NULL DEFAULT ARRAY['CZ', 'SK', 'AT', 'PL', 'DE'],
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('✓ user_preferences table created successfully');
    } catch (error) {
      console.error('Error creating user_preferences table:', error);
      throw error;
    }

    // Step 4: Populate country columns for existing routes
    console.log('\n=== Step 4: Populating country data for existing routes ===');

    // Fetch all routes that need country population
    const routesResult = await client.query(`
      SELECT track_id, ST_AsGeoJSON(geometry) as geometry_json
      FROM railway_routes
      WHERE start_country IS NULL OR end_country IS NULL
    `);

    const totalRoutes = routesResult.rows.length;
    console.log(`Found ${totalRoutes} routes to process`);

    if (totalRoutes === 0) {
      console.log('No routes need country population');
    } else {
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < routesResult.rows.length; i++) {
        const route = routesResult.rows[i];
        const trackId = route.track_id;

        try {
          // Parse geometry from PostGIS GeoJSON
          const geometryData = JSON.parse(route.geometry_json);

          // Determine countries from geometry
          const { startCountry, endCountry } = getRouteCountries(geometryData);

          if (startCountry && endCountry) {
            // Update route with country information
            await client.query(`
              UPDATE railway_routes
              SET start_country = $1, end_country = $2, updated_at = NOW()
              WHERE track_id = $3
            `, [startCountry, endCountry, trackId]);

            successCount++;

            // Log progress every 100 routes
            if ((i + 1) % 100 === 0) {
              console.log(`Processed ${i + 1}/${totalRoutes} routes...`);
            }
          } else {
            console.warn(`⚠ Could not determine countries for route ${trackId} (start: ${startCountry}, end: ${endCountry})`);
            failCount++;
          }
        } catch (error) {
          console.error(`Error processing route ${trackId}:`, error);
          failCount++;
        }
      }

      console.log(`\n✓ Country population complete:`);
      console.log(`  - Success: ${successCount} routes`);
      console.log(`  - Failed: ${failCount} routes`);
    }

    // Step 5: Create default preferences for existing users
    console.log('\n=== Step 5: Creating default preferences for existing users ===');

    try {
      // Insert default preferences for users who don't have them yet
      await client.query(`
        INSERT INTO user_preferences (user_id, selected_countries)
        SELECT id, ARRAY['CZ', 'SK', 'AT', 'PL', 'DE']::TEXT[]
        FROM users
        WHERE id NOT IN (SELECT user_id FROM user_preferences)
      `);

      const prefsCount = await client.query(`SELECT COUNT(*) FROM user_preferences`);
      console.log(`✓ Default preferences created (${prefsCount.rows[0].count} users)`);
    } catch (error) {
      console.error('Error creating default preferences:', error);
      throw error;
    }

    console.log('\n=== Migration completed successfully ===');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

// Run the migration
runMigration().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
