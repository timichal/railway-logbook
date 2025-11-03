#!/usr/bin/env tsx
/**
 * Combined Migration: Schema changes + Link field
 * Date: 2025-11-03
 *
 * This migration combines both:
 * 1. Schema changes from 2025-01 (usage_type, frequency, user_trips)
 * 2. Link field addition
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
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
    console.log('Starting combined migration');
    console.log('=====================================\n');

    await client.query('BEGIN');

    // Check if user_trips already exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'user_trips'
      );
    `);

    const userTripsExists = tableCheck.rows[0].exists;

    if (!userTripsExists) {
      console.log('Step 1: Running schema migration (user_railway_data -> user_trips)...');

      // Add frequency column
      console.log('  - Adding frequency column...');
      await client.query(`
        ALTER TABLE railway_routes
        ADD COLUMN IF NOT EXISTS frequency TEXT[] DEFAULT ARRAY[]::TEXT[];
      `);

      // Migrate Seasonal routes (usage_type=1 -> 0 with frequency=['Seasonal'])
      console.log('  - Migrating Seasonal routes...');
      await client.query(`
        UPDATE railway_routes
        SET usage_type = 0, frequency = ARRAY['Seasonal']
        WHERE usage_type = 1;
      `);

      // Update Special routes (usage_type=2 -> 1)
      console.log('  - Updating Special routes...');
      await client.query(`
        UPDATE railway_routes
        SET usage_type = 1
        WHERE usage_type = 2;
      `);

      // Create user_trips table
      console.log('  - Creating user_trips table...');
      await client.query(`
        CREATE TABLE user_trips (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          track_id INTEGER NOT NULL REFERENCES railway_routes(track_id) ON DELETE CASCADE,
          date DATE,
          note TEXT,
          partial BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create indexes
      console.log('  - Creating indexes...');
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_user_trips_user_id ON user_trips(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_trips_track_id ON user_trips(track_id);
        CREATE INDEX IF NOT EXISTS idx_user_trips_date ON user_trips(date);
      `);

      // Migrate data from user_railway_data to user_trips
      console.log('  - Migrating data from user_railway_data...');
      const dataExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'user_railway_data'
        );
      `);

      if (dataExists.rows[0].exists) {
        await client.query(`
          INSERT INTO user_trips (user_id, track_id, date, note, partial, created_at, updated_at)
          SELECT user_id, track_id, date, note, partial, created_at, updated_at
          FROM user_railway_data;
        `);

        // Drop old table
        console.log('  - Dropping user_railway_data table...');
        await client.query(`DROP TABLE user_railway_data;`);
      }

      console.log('✓ Schema migration completed\n');
    } else {
      console.log('Step 1: Skipping schema migration (user_trips already exists)\n');
    }

    // Check if link column exists
    const linkCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'railway_routes'
        AND column_name = 'link'
      );
    `);

    const linkExists = linkCheck.rows[0].exists;

    if (!linkExists) {
      console.log('Step 2: Adding link field...');
      await client.query(`
        ALTER TABLE railway_routes
        ADD COLUMN link TEXT;
      `);
      console.log('✓ Link column added\n');
    } else {
      console.log('Step 2: Skipping link field (already exists)\n');
    }

    // Update vector tile function
    console.log('Step 3: Updating vector tile function...');
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
                  rr.frequency,
                  rr.link,
                  rr.is_valid,
                  rr.error_message,
                  rr.starting_part_id,
                  rr.ending_part_id,
                  -- Include most recent trip data for client-side styling
                  -- Use latest trip (by date, then by created_at) for route coloring
                  ut.date,
                  ut.note,
                  ut.partial,
                  -- Simplify geometry for tile display
                  ST_AsMVTGeom(
                      rr.geometry_3857,
                      tile_envelope,
                      4096,
                      64,
                      true
                  ) AS geom
              FROM railway_routes rr
              LEFT JOIN LATERAL (
                  SELECT date, note, partial
                  FROM user_trips
                  WHERE track_id = rr.track_id
                      AND (user_id_param IS NULL OR user_id = user_id_param)
                  ORDER BY
                      date DESC NULLS LAST,
                      created_at DESC
                  LIMIT 1
              ) ut ON true
              WHERE
                  -- Spatial filter using index
                  rr.geometry_3857 && tile_envelope
                  -- Show routes at all zoom levels (no zoom restriction)
              ORDER BY
                  -- Render order: unvisited routes first (so visited are on top)
                  CASE WHEN ut.date IS NULL THEN 0 ELSE 1 END,
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
    console.log('✓ Vector tile function updated\n');

    await client.query('COMMIT');

    console.log('=====================================');
    console.log('Combined migration completed successfully!');
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
