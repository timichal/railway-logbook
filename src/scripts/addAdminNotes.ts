#!/usr/bin/env tsx
/**
 * Migration script to add admin_notes table
 *
 * Creates a new table for admin-only map notes with:
 * - id (auto-incrementing primary key)
 * - coordinate (PostGIS POINT geometry)
 * - text (note content)
 * - created_at (timestamp when note was created)
 * - updated_at (timestamp of last edit, auto-updated)
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function addAdminNotes() {
  const client = await pool.connect();

  try {
    console.log('Creating admin_notes table...');
    console.log('=====================================\n');

    // Check if table already exists
    const checkTable = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'admin_notes'
      );
    `);

    if (checkTable.rows[0].exists) {
      console.log('✓ admin_notes table already exists, skipping creation\n');
      return;
    }

    // Create admin_notes table
    await client.query(`
      CREATE TABLE admin_notes (
        id SERIAL PRIMARY KEY,
        coordinate GEOMETRY(POINT, 4326) NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✓ Created admin_notes table');

    // Create spatial index for efficient coordinate queries
    await client.query(`
      CREATE INDEX idx_admin_notes_coordinate
      ON admin_notes USING GIST (coordinate);
    `);

    console.log('✓ Created spatial index on coordinate column');

    // Create trigger to auto-update updated_at timestamp
    await client.query(`
      CREATE OR REPLACE FUNCTION update_admin_notes_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER admin_notes_update_timestamp
      BEFORE UPDATE ON admin_notes
      FOR EACH ROW
      EXECUTE FUNCTION update_admin_notes_timestamp();
    `);

    console.log('✓ Created auto-update trigger for updated_at column');

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
addAdminNotes().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
