#!/usr/bin/env tsx
/**
 * Migration: Add railway_part_splits table
 *
 * This script creates the railway_part_splits table for storing manually split
 * railway segments with compound IDs (e.g., "12345-1", "12345-2").
 * Used for detailed route creation when OSM segments are too long.
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function addRailwayPartSplitsTable() {
  const client = await pool.connect();

  try {
    console.log('Starting migration: Add railway_part_splits table');
    console.log('====================================================\n');

    // Check if table already exists
    console.log('Checking if railway_part_splits table exists...');
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'railway_part_splits'
      );
    `);

    if (tableCheck.rows[0].exists) {
      console.log('✓ Table railway_part_splits already exists. Skipping creation.\n');
      console.log('Checking for missing indices...');
    } else {
      console.log('✗ Table does not exist. Creating table...\n');

      // Create the railway_part_splits table
      await client.query(`
        CREATE TABLE railway_part_splits (
          id TEXT PRIMARY KEY, -- Compound ID format: "parent_id-segment_number" (e.g., "12345-1")
          parent_id BIGINT NOT NULL, -- Reference to original railway_parts.id
          segment_number INTEGER NOT NULL CHECK (segment_number IN (1, 2)), -- Which segment of the split (1 or 2)
          geometry GEOMETRY(LINESTRING, 4326) NOT NULL, -- PostGIS LineString for the split segment
          geometry_3857 GEOMETRY(LINESTRING, 3857), -- Web Mercator projection for tile serving
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT unique_parent_segment UNIQUE (parent_id, segment_number)
        );
      `);
      console.log('✓ Created table railway_part_splits\n');
    }

    // Create indices (safe to run even if they exist)
    console.log('Creating indices...');

    // Geometry index (4326)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_railway_part_splits_geometry
      ON railway_part_splits USING GIST (geometry);
    `);
    console.log('✓ Created index idx_railway_part_splits_geometry');

    // Geometry index (3857 - Web Mercator)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_railway_part_splits_geometry_3857
      ON railway_part_splits USING GIST (geometry_3857);
    `);
    console.log('✓ Created index idx_railway_part_splits_geometry_3857');

    // Parent ID index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_railway_part_splits_parent_id
      ON railway_part_splits (parent_id);
    `);
    console.log('✓ Created index idx_railway_part_splits_parent_id');

    console.log('\n====================================================');
    console.log('Migration completed successfully!');
    console.log('====================================================\n');

    console.log('Summary:');
    console.log('- Table: railway_part_splits');
    console.log('- Indices: 3 (geometry, geometry_3857, parent_id)');
    console.log('- Purpose: Store manually split railway segments for detailed routing\n');

  } catch (error) {
    console.error('\n✗ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
addRailwayPartSplitsTable().catch((error) => {
  console.error('Script error:', error);
  process.exit(1);
});
