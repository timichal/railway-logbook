import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import dotenv from 'dotenv';
import { loadStationsAndParts } from './lib/loadRailwayData';
import { getDbConfig } from '../lib/db-config';

dotenv.config();

// Get database config after dotenv loads environment variables
const dbConfig = getDbConfig();

async function executeSQLFile(client: Client, filePath: string): Promise<void> {
  console.log(`Executing SQL file: ${path.basename(filePath)}`);
  try {
    const sqlContent = fs.readFileSync(filePath, 'utf8');
    await client.query(sqlContent);
    console.log(`✓ Successfully executed ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`✗ Error executing ${path.basename(filePath)}:`, error);
    throw error;
  }
}

async function initializeDatabase(client: Client): Promise<void> {
  console.log('Initializing database with SQL files...');
  
  // Execute SQL files in order
  const sqlFiles = [
    './database/init/02-vector-tiles.sql'
  ];

  for (const sqlFile of sqlFiles) {
    if (fs.existsSync(sqlFile)) {
      await executeSQLFile(client, sqlFile);
    } else {
      console.warn(`⚠ SQL file not found: ${sqlFile}`);
    }
  }
}

async function loadGeoJSONData(): Promise<void> {
  const client = new Client(dbConfig);

  try {
    await client.connect();
    console.log('Connected to database');

    // Initialize database with SQL files (vector tile functions, etc.)
    await initializeDatabase(client);

    // Load stations and railway parts from pruned GeoJSON
    const prunedDataPath = './data/czech-republic-pruned-250101.geojson';
    await loadStationsAndParts(client, prunedDataPath);

  } catch (error) {
    console.error('Error loading data:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the script
loadGeoJSONData().catch(console.error);
