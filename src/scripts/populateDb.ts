import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Database connection configuration
interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

const dbConfig: DbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'railmap',
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
};

// GeoJSON types
interface GeoJSONGeometry {
  type: 'Point' | 'LineString';
  coordinates: number[] | number[][];
}

interface GeoJSONProperties {
  '@id'?: number;
  name?: string;
  track_id?: string;
  description?: string;
  usage?: number[];
  primary_operator?: string;
  date?: string;
  note?: string;
}

interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONGeometry;
  properties: GeoJSONProperties;
}


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

    // Clear existing data
    console.log('Clearing existing data...');
    await client.query('DELETE FROM railway_parts');
    await client.query('DELETE FROM stations');

    let stationsCount = 0;
    let partsCount = 0;

    // First, process pruned geojson data for stations and railway_parts
    console.log('Processing europe-pruned.geojson for stations and railway parts...');
    const prunedDataPath = './data/europe-pruned.geojson';

    // Process file in streaming fashion to avoid memory issues
    console.log('Reading GeoJSON file...');
    const fileContent = fs.readFileSync(prunedDataPath, 'utf8');
    console.log('Parsing JSON...');

    // Parse in chunks to manage memory
    const BATCH_SIZE = 1000;
    let stationRows: string[] = [];
    let partRows: string[] = [];

    // Use a more memory-efficient parsing approach
    const startIndex = fileContent.indexOf('"features":[') + '"features":['.length;
    const endIndex = fileContent.lastIndexOf(']');

    // Process features in batches by parsing them incrementally
    const currentPos = startIndex;
    let featureCount = 0;
    let braceDepth = 0;
    let currentFeature = '';
    let inString = false;
    let escapeNext = false;

    console.log('Processing features in batches...');

    for (let i = currentPos; i < endIndex; i++) {
      const char = fileContent[i];

      if (escapeNext) {
        escapeNext = false;
        currentFeature += char;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        currentFeature += char;
        continue;
      }

      if (char === '"') {
        inString = !inString;
      }

      if (!inString) {
        if (char === '{') braceDepth++;
        if (char === '}') braceDepth--;
      }

      currentFeature += char;

      // When we complete a feature object
      if (braceDepth === 0 && currentFeature.trim().length > 0 && !inString) {
        try {
          const feature: GeoJSONFeature = JSON.parse(currentFeature.replace(/^,\s*/, ''));
          featureCount++;

          const { geometry, properties } = feature;

          if (geometry.type === 'Point') {
            // Handle stations
            const [lon, lat] = geometry.coordinates as [number, number];
            const id = properties['@id'];
            const name = (properties.name || 'Unknown Station').replace(/'/g, "''");

            stationRows.push(`(${id}, '${name}', ST_MakePoint(${lon}, ${lat}))`);
            stationsCount++;

          } else if (geometry.type === 'LineString') {
            // Handle railway parts
            if (!properties['@id']) {
              continue;
            }

            const coords = geometry.coordinates as number[][];
            const coordsStr = coords
              .map(coord => `${coord[0]} ${coord[1]}`)
              .join(',');
            const lineString = `LINESTRING(${coordsStr})`;
            const id = properties['@id'];

            partRows.push(`(${id}, ST_GeomFromText('${lineString}', 4326))`);
            partsCount++;
          }

          // Insert batches when they reach BATCH_SIZE
          if (stationRows.length >= BATCH_SIZE) {
            await client.query(`
              INSERT INTO stations (id, name, coordinates)
              VALUES ${stationRows.join(', ')}
              ON CONFLICT (id) DO NOTHING
            `);
            stationRows = [];
          }

          if (partRows.length >= BATCH_SIZE) {
            await client.query(`
              INSERT INTO railway_parts (id, geometry)
              VALUES ${partRows.join(', ')}
              ON CONFLICT (id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            `);
            partRows = [];
          }

          if (featureCount % 10000 === 0) {
            console.log(`Processed ${featureCount} features...`);
          }

        } catch (_e) {
          // Skip malformed features
        }

        currentFeature = '';
      }
    }

    console.log(`Processed ${featureCount} features total`);

    // Insert remaining batches
    if (stationRows.length > 0) {
      console.log(`Inserting final batch of ${stationRows.length} stations...`);
      await client.query(`
        INSERT INTO stations (id, name, coordinates)
        VALUES ${stationRows.join(', ')}
        ON CONFLICT (id) DO NOTHING
      `);
    }

    if (partRows.length > 0) {
      console.log(`Inserting final batch of ${partRows.length} railway parts...`);
      await client.query(`
        INSERT INTO railway_parts (id, geometry)
        VALUES ${partRows.join(', ')}
        ON CONFLICT (id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      `);
    }

    console.log('Railway routes population removed - will be managed via admin interface');

    console.log(`Data loading completed successfully!`);
    console.log(`- Stations loaded: ${stationsCount}`);
    console.log(`- Railway parts loaded: ${partsCount}`);

  } catch (error) {
    console.error('Error loading data:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the script
loadGeoJSONData().catch(console.error);
