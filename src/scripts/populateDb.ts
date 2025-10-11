import fs from 'fs';
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

    // Clear existing data
    console.log('Clearing existing data...');
    await client.query('DELETE FROM railway_parts');
    await client.query('DELETE FROM stations');

    let stationsCount = 0;
    let partsCount = 0;

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
