/**
 * Migration script to add railway_part_splits table
 * This enables manual splitting of railway parts for better alignment with stations
 */

import { Client } from 'pg';
import dotenv from 'dotenv';
import { getDbConfig } from '../lib/dbConfig';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Get database config after dotenv loads environment variables
const dbConfig = getDbConfig();

async function runMigration(): Promise<void> {
  const client = new Client(dbConfig);

  try {
    await client.connect();
    console.log('Connected to database');

    // Read and execute the migration SQL file
    console.log('\n=== Creating railway_part_splits table ===');

    const migrationPath = path.join(__dirname, '../../database/migrations/add_railway_part_splits.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    try {
      await client.query(migrationSQL);
      console.log('✓ railway_part_splits table created successfully');
    } catch (error) {
      console.error('Error creating table:', error);
      throw error;
    }

    // Verify table was created
    const tableCheck = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'railway_part_splits'
    `);

    if (tableCheck.rows[0].count === '1') {
      console.log('✓ Table verified in database');
    } else {
      throw new Error('Table creation verification failed');
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
