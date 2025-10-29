/**
 * Migration: Split route name into from/to fields
 * Adds "from" and "to" columns, migrates data from "name" field, then removes "name"
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '@/lib/db-config';

// Load environment variables BEFORE creating pool
dotenv.config();

// Create pool with loaded config
const pool = new Pool(getDbConfig());

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('Starting migration: Split route name into from/to fields');

    // Start transaction
    await client.query('BEGIN');

    // Step 1: Add new columns (temporarily nullable)
    console.log('Step 1: Adding from_station/to_station columns...');
    await client.query(`
      ALTER TABLE railway_routes
      ADD COLUMN IF NOT EXISTS from_station TEXT,
      ADD COLUMN IF NOT EXISTS to_station TEXT
    `);

    // Step 2: Fetch all routes with their names
    console.log('Step 2: Fetching existing routes...');
    const { rows: routes } = await client.query(
      'SELECT track_id, name FROM railway_routes ORDER BY track_id'
    );
    console.log(`Found ${routes.length} routes to migrate`);

    // Step 3: Migrate data
    console.log('Step 3: Migrating data from name to from_station/to_station...');
    let successCount = 0;
    let failCount = 0;

    for (const route of routes) {
      const { track_id, name } = route;

      // Split by ' ⟷ ' (note spaces around arrow)
      const parts = name.split(' ⟷ ');

      if (parts.length === 2) {
        // Successfully split
        const from = parts[0].trim();
        const to = parts[1].trim();

        await client.query(
          'UPDATE railway_routes SET from_station = $1, to_station = $2 WHERE track_id = $3',
          [from, to, track_id]
        );
        successCount++;
      } else {
        // Failed to split - log and set to TODO
        console.warn(`⚠️  Could not split route ${track_id}: "${name}"`);
        await client.query(
          'UPDATE railway_routes SET from_station = $1, to_station = $2 WHERE track_id = $3',
          ['TODO', 'TODO', track_id]
        );
        failCount++;
      }
    }

    console.log(`✓ Successfully migrated ${successCount} routes`);
    if (failCount > 0) {
      console.log(`⚠️  ${failCount} routes set to TODO (could not split name)`);
    }

    // Step 4: Make columns NOT NULL
    console.log('Step 4: Making from_station/to_station columns NOT NULL...');
    await client.query(`
      ALTER TABLE railway_routes
      ALTER COLUMN from_station SET NOT NULL,
      ALTER COLUMN to_station SET NOT NULL
    `);

    // Step 5: Drop name column
    console.log('Step 5: Dropping name column...');
    await client.query(`
      ALTER TABLE railway_routes
      DROP COLUMN name
    `);

    // Step 6: Update vector tile function to use from_station/to_station
    console.log('Step 6: Updating railway_routes_tile function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION railway_routes_tile(z integer, x integer, y integer, query_params json DEFAULT '{}'::json)
      RETURNS bytea AS $$
      DECLARE
          result bytea;
          tile_envelope geometry;
          user_id_param integer;
      BEGIN
          -- Get the tile envelope in Web Mercator
          tile_envelope := ST_TileEnvelope(z, x, y);

          -- Extract user_id from query params (for user-specific styling)
          user_id_param := (query_params->>'user_id')::integer;

          -- Generate MVT tile
          SELECT INTO result ST_AsMVT(mvtgeom.*, 'railway_routes')
          FROM (
              SELECT
                  rr.track_id,
                  rr.from_station,
                  rr.to_station,
                  rr.track_number,
                  rr.description,
                  rr.usage_type,
                  rr.is_valid,
                  rr.error_message,
                  rr.starting_part_id,
                  rr.ending_part_id,
                  -- Include user-specific data for client-side styling
                  urd.date,
                  urd.note,
                  urd.partial,
                  -- Simplify geometry for tile display
                  ST_AsMVTGeom(
                      rr.geometry_3857,
                      tile_envelope,
                      4096,
                      64,
                      true
                  ) AS geom
              FROM railway_routes rr
              LEFT JOIN user_railway_data urd
                  ON rr.track_id = urd.track_id
                  AND (user_id_param IS NULL OR urd.user_id = user_id_param)
              WHERE
                  -- Spatial filter using index
                  rr.geometry_3857 && tile_envelope
                  -- Show routes at all zoom levels (no zoom restriction)
              ORDER BY
                  -- Render order: unvisited routes first (so visited are on top)
                  CASE WHEN urd.date IS NULL THEN 0 ELSE 1 END,
                  rr.from_station,
                  rr.to_station
          ) AS mvtgeom
          WHERE geom IS NOT NULL;

          RETURN result;
      END;
      $$ LANGUAGE plpgsql
      IMMUTABLE
      STRICT
      PARALLEL SAFE;
    `);

    // Commit transaction
    await client.query('COMMIT');
    console.log('✓ Migration completed successfully!');
  } catch (error) {
    // Rollback on error
    await client.query('ROLLBACK');
    console.error('✗ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run migration
runMigration().catch((error) => {
  console.error('Migration error:', error);
  process.exit(1);
});
