import { Client } from 'pg';
import dotenv from 'dotenv';
import { loadStationsAndParts } from './lib/loadRailwayData';
import { getDbConfig } from '../lib/db-config';

dotenv.config();

// Get database config after dotenv loads environment variables
const dbConfig = getDbConfig();

async function loadGeoJSONData(): Promise<void> {
  const client = new Client(dbConfig);

  try {
    // Get data file path from command line argument (required)
    const dataPath = process.argv[2];

    if (!dataPath) {
      console.error('Error: Data file path is required');
      console.error('Usage: npm run populateDb <filepath>');
      console.error('Example: npm run populateDb ./data/cz-pruned.geojson');
      process.exit(1);
    }

    console.log(`Using data file: ${dataPath}`);

    await client.connect();
    console.log('Connected to database');

    // Load stations and railway parts from pruned GeoJSON
    await loadStationsAndParts(client, dataPath);

  } catch (error) {
    console.error('Error loading data:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the script
loadGeoJSONData().catch(console.error);
