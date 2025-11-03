#!/usr/bin/env tsx
/**
 * Migration: Add link field to railway_routes table
 * Date: 2025-11-03
 *
 * This migration adds a new 'link' TEXT field to the railway_routes table
 * to store external URLs for routes.
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/db-config';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Starting migration: Add link field to railway_routes');
    console.log('=====================================\n');

    await client.query('BEGIN');

    // Step 1: Add link column to railway_routes
    console.log('Step 1: Adding link column to railway_routes table...');
    await client.query(`
      ALTER TABLE railway_routes
      ADD COLUMN IF NOT EXISTS link TEXT;
    `);
    console.log('✓ Link column added\n');

    // Step 2: Update vector tile function to include link field
    console.log('Step 2: Updating vector tile function to include link field...');
    await client.query(`
      CREATE OR REPLACE FUNCTION railway_routes_tile(
        z integer,
        x integer,
        y integer,
        user_id_param integer DEFAULT NULL
      )
      RETURNS bytea
      LANGUAGE plpgsql
      STABLE
      AS $$
      DECLARE
        result bytea;
      BEGIN
        SELECT INTO result ST_AsMVT(tile, 'railway_routes', 4096, 'geom')
        FROM (
          SELECT
            rr.track_id,
            rr.from_station,
            rr.to_station,
            rr.track_number,
            rr.description,
            rr.usage_type,
            rr.frequency,
            rr.link,
            rr.length_km,
            rr.is_valid,
            ut.date,
            ut.note,
            ut.partial,
            ST_AsMVTGeom(
              rr.geometry,
              ST_TileEnvelope(z, x, y),
              4096,
              256,
              true
            ) AS geom
          FROM railway_routes rr
          LEFT JOIN LATERAL (
            SELECT date, note, partial
            FROM user_trips
            WHERE track_id = rr.track_id
              AND (user_id_param IS NULL OR user_id = user_id_param)
            ORDER BY date DESC NULLS LAST, created_at DESC
            LIMIT 1
          ) ut ON true
          WHERE rr.geometry && ST_TileEnvelope(z, x, y)
        ) AS tile
        WHERE geom IS NOT NULL;

        RETURN result;
      END;
      $$
      PARALLEL SAFE;
    `);
    console.log('✓ Vector tile function updated\n');

    await client.query('COMMIT');

    console.log('=====================================');
    console.log('Migration completed successfully!');
    console.log('=====================================\n');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed! Rolling back changes...');
    console.error('Error:', error);
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
