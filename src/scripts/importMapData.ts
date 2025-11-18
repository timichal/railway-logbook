import { Client } from 'pg';
import dotenv from 'dotenv';
import { loadStationsAndParts } from './lib/loadRailwayData';
import { verifyAndRecalculateRoutes } from './verifyRouteData';
import { validateSplitPartsAfterImport } from './lib/validateSplitParts';
import { getDbConfig } from '../lib/dbConfig';

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
      console.error('Usage: npm run importMapData <filepath>');
      console.error('Example: npm run importMapData ./data/europe-pruned-251027.geojson');
      process.exit(1);
    }

    // Validate file extension
    if (!dataPath.toLowerCase().endsWith('.geojson')) {
      console.error('Error: File must be a .geojson file');
      console.error(`Provided file: ${dataPath}`);
      console.error('Usage: npm run importMapData <filepath>');
      console.error('Example: npm run importMapData ./data/europe-pruned-251027.geojson');
      process.exit(1);
    }

    console.log(`Using data file: ${dataPath}`);

    await client.connect();
    console.log('Connected to database');

    // Step 1: Load stations and railway parts from pruned GeoJSON
    console.log('');
    console.log('=== Step 1: Loading map data ===');
    await loadStationsAndParts(client, dataPath);

    // Step 2: Verify and recalculate routes if they exist
    console.log('');
    console.log('=== Step 2: Verifying routes ===');
    await verifyAndRecalculateRoutes(client);

    // Step 3: Validate split parts after data reload
    console.log('');
    console.log('=== Step 3: Validating split parts ===');
    await validateSplitPartsAfterImport(client);

    console.log('');
    console.log('Database update completed!');

  } catch (error) {
    console.error('Error loading data:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the script
loadGeoJSONData().catch(console.error);
