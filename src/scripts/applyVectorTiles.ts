import { Client } from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getDbConfig } from '../lib/dbConfig';

dotenv.config();

// Get database config after dotenv loads environment variables
const dbConfig = getDbConfig();

async function applyVectorTilesSql() {
  const client = new Client(dbConfig);

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully');

    // Read the SQL file
    const sqlPath = join(process.cwd(), 'database', 'init', '02-vector-tiles.sql');
    console.log(`Reading SQL file: ${sqlPath}`);
    const sql = readFileSync(sqlPath, 'utf-8');

    console.log('Executing SQL...');
    await client.query(sql);
    console.log('✓ Vector tiles SQL applied successfully');

  } catch (error) {
    console.error('Error applying vector tiles SQL:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

// Run the script
applyVectorTilesSql();
