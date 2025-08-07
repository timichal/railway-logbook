import fs from 'fs';
import { Client } from 'pg';
import { Usage } from '../enums';
import dotenv from 'dotenv';

dotenv.config({ path: './frontend/.env' });

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
  usage?: Usage[];
  primary_operator?: string;
  last_ride?: string;
  note?: string;
}

interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONGeometry;
  properties: GeoJSONProperties;
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

async function loadGeoJSONData(): Promise<void> {
  const client = new Client(dbConfig);

  try {
    await client.connect();
    console.log('Connected to database');

    // Read the GeoJSON file
    const geoJsonPath = './data/merged-only.geojson';
    console.log('Reading GeoJSON file...');
    const geoJsonData: GeoJSONFeatureCollection = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));

    // Clear existing data
    console.log('Clearing existing data...');
    await client.query('DELETE FROM user_railway_data');
    await client.query('DELETE FROM railway_routes');
    await client.query('DELETE FROM railway_parts');
    await client.query('DELETE FROM stations');

    let stationsCount = 0;
    let partsCount = 0;
    let routesCount = 0;
    let userDataCount = 0;

    // First, process cz-pruned.geojson for stations and railway_parts
    console.log('Processing cz-pruned.geojson for stations and railway parts...');
    const czPrunedPath = './data/cz-pruned.geojson';
    const czPrunedData: GeoJSONFeatureCollection = JSON.parse(fs.readFileSync(czPrunedPath, 'utf8'));

    // Collect data for batch inserts
    const stationRows: string[] = [];
    const partRows: string[] = [];

    console.log(`Processing ${czPrunedData.features.length} features...`);

    for (const feature of czPrunedData.features) {
      const { geometry, properties } = feature;

      if (geometry.type === 'Point') {
        // Handle stations
        const [lon, lat] = geometry.coordinates as [number, number];
        const id = properties['@id'];
        const name = (properties.name || 'Unknown Station').replace(/'/g, "''"); // Escape single quotes
        
        stationRows.push(`(${id}, '${name}', ST_MakePoint(${lon}, ${lat}))`);
        stationsCount++;

      } else if (geometry.type === 'LineString') {
        // Handle railway parts
        if (!properties['@id']) {
          console.warn('Skipping LineString feature without @id');
          continue;
        }

        // Convert coordinates to PostGIS LineString format
        const coords = geometry.coordinates as number[][];
        const coordsStr = coords
          .map(coord => `${coord[0]} ${coord[1]}`)
          .join(',');
        const lineString = `LINESTRING(${coordsStr})`;
        const id = properties['@id'];
        
        partRows.push(`(${id}, ST_GeomFromText('${lineString}', 4326))`);
        partsCount++;
      }
    }

    // Batch insert stations
    if (stationRows.length > 0) {
      console.log(`Batch inserting ${stationRows.length} stations...`);
      const BATCH_SIZE = 1000;
      for (let i = 0; i < stationRows.length; i += BATCH_SIZE) {
        const batch = stationRows.slice(i, i + BATCH_SIZE);
        const query = `
          INSERT INTO stations (id, name, coordinates)
          VALUES ${batch.join(', ')}
          ON CONFLICT (id) DO NOTHING
        `;
        await client.query(query);
      }
    }

    // Batch insert railway parts
    if (partRows.length > 0) {
      console.log(`Batch inserting ${partRows.length} railway parts...`);
      const BATCH_SIZE = 1000;
      for (let i = 0; i < partRows.length; i += BATCH_SIZE) {
        const batch = partRows.slice(i, i + BATCH_SIZE);
        const query = `
          INSERT INTO railway_parts (id, geometry)
          VALUES ${batch.join(', ')}
          ON CONFLICT (id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
        `;
        await client.query(query);
      }
    }

    // Now process merged-only.geojson for railway routes
    console.log('Processing merged-only.geojson for railway routes...');
    const mergedData: GeoJSONFeatureCollection = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));

    // Collect data for batch inserts
    const routeRows: string[] = [];
    const userDataRows: string[] = [];

    console.log(`Processing ${mergedData.features.length} route features...`);

    for (const feature of mergedData.features) {
      const { geometry, properties } = feature;

      if (geometry.type === 'LineString') {
        // Handle railway routes
        if (!properties.track_id) {
          console.warn('Skipping LineString feature without track_id:', properties.name);
          continue;
        }

        // Convert coordinates to PostGIS LineString format
        const coords = geometry.coordinates as number[][];
        const coordsStr = coords
          .map(coord => `${coord[0]} ${coord[1]}`)
          .join(',');
        const lineString = `LINESTRING(${coordsStr})`;

        // Get usage types and operator directly from properties
        const usageTypes = properties.usage || [];
        const primaryOperator = properties.primary_operator || 'Unknown';
        
        // Escape single quotes in strings
        const trackId = properties.track_id.replace(/'/g, "''");
        const name = (properties.name || 'Unknown Route').replace(/'/g, "''");
        const description = properties.description ? properties.description.replace(/'/g, "''") : null;
        const operator = primaryOperator.replace(/'/g, "''");
        const usageArray = `{${usageTypes.map(u => `"${u}"`).join(',')}}`;

        routeRows.push(`('${trackId}', '${name}', ${description ? `'${description}'` : 'NULL'}, '${usageArray}', '${operator}', ST_GeomFromText('${lineString}', 4326))`);
        routesCount++;

        // Extract and insert user data (last_ride, notes) from properties
        const lastRide = properties.last_ride || null;
        const note = properties.note || null;

        // Insert user data if we have any
        if (lastRide || note) {
          const noteEscaped = note ? note.replace(/'/g, "''") : null;
          userDataRows.push(`(1, '${trackId}', ${lastRide ? `'${lastRide}'` : 'NULL'}, ${noteEscaped ? `'${noteEscaped}'` : 'NULL'})`);
          userDataCount++;
        }
      }
    }

    // Batch insert railway routes
    if (routeRows.length > 0) {
      console.log(`Batch inserting ${routeRows.length} railway routes...`);
      const BATCH_SIZE = 500; // Smaller batches for complex geometry
      for (let i = 0; i < routeRows.length; i += BATCH_SIZE) {
        const batch = routeRows.slice(i, i + BATCH_SIZE);
        const query = `
          INSERT INTO railway_routes (track_id, name, description, usage_types, primary_operator, geometry)
          VALUES ${batch.join(', ')}
          ON CONFLICT (track_id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            usage_types = EXCLUDED.usage_types,
            primary_operator = EXCLUDED.primary_operator,
            updated_at = CURRENT_TIMESTAMP
        `;
        await client.query(query);
      }
    }

    // Batch insert user data
    if (userDataRows.length > 0) {
      console.log(`Batch inserting ${userDataRows.length} user data entries...`);
      const BATCH_SIZE = 1000;
      for (let i = 0; i < userDataRows.length; i += BATCH_SIZE) {
        const batch = userDataRows.slice(i, i + BATCH_SIZE);
        const query = `
          INSERT INTO user_railway_data (user_id, track_id, last_ride, note)
          VALUES ${batch.join(', ')}
          ON CONFLICT (user_id, track_id) DO UPDATE SET
            last_ride = EXCLUDED.last_ride,
            note = EXCLUDED.note,
            updated_at = CURRENT_TIMESTAMP
        `;
        await client.query(query);
      }
    }

    console.log(`Data loading completed successfully!`);
    console.log(`- Stations loaded: ${stationsCount}`);
    console.log(`- Railway parts loaded: ${partsCount}`);
    console.log(`- Railway routes loaded: ${routesCount}`);
    console.log(`- User data entries loaded: ${userDataCount}`);

  } catch (error) {
    console.error('Error loading data:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the script
loadGeoJSONData().catch(console.error);
