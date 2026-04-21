#!/usr/bin/env tsx
/**
 * Add nullable `note_type` column to admin_notes table.
 *
 * Values: 'Usage' | 'Works' | 'Todo' | NULL (legacy notes have no type).
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

dotenv.config();

const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function addNoteTypeColumn() {
  const client = await pool.connect();

  try {
    console.log('Adding note_type column to admin_notes...');

    await client.query(`
      ALTER TABLE admin_notes
      ADD COLUMN IF NOT EXISTS note_type VARCHAR(20)
      CHECK (note_type IN ('Usage', 'Works', 'Todo'));
    `);

    console.log('✓ note_type column added (nullable)');
  } catch (error) {
    console.error('Error adding note_type column:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

addNoteTypeColumn().catch((error) => {
  console.error('Script error:', error);
  process.exit(1);
});
