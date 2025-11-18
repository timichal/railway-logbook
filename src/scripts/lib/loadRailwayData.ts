import fs from 'fs';
import { Client } from 'pg';

// GeoJSON types
interface GeoJSONGeometry {
  type: 'Point' | 'LineString';
  coordinates: number[] | number[][];
}

interface GeoJSONProperties {
  '@id'?: number;
  name?: string;
  [key: string]: unknown;
}

interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONGeometry;
  properties: GeoJSONProperties;
}

export interface LoadResult {
  stationsCount: number;
  partsCount: number;
  geometryChanges?: {
    changedPartIds: string[];
    affectedRoutes: number;
  };
}

/**
 * Load stations and railway parts from a GeoJSON file into the database
 * Clears existing data before loading
 */
export async function loadStationsAndParts(
  client: Client,
  geojsonPath: string
): Promise<LoadResult> {
  console.log(`Loading data from ${geojsonPath}...`);

  // Before clearing data, check for parts with splits and save their geometries
  console.log('Checking for split parts with geometry changes...');
  const splitPartsResult = await client.query(`
    SELECT
      rps.part_id,
      ST_AsText(rp.geometry) as old_geometry
    FROM railway_part_splits rps
    JOIN railway_parts rp ON rp.id = rps.part_id
  `);

  const oldSplitGeometries = new Map<string, string>();
  for (const row of splitPartsResult.rows) {
    oldSplitGeometries.set(row.part_id.toString(), row.old_geometry);
  }

  console.log(`Found ${oldSplitGeometries.size} parts with active splits`);

  // Clear existing data (CASCADE will auto-delete splits)
  console.log('Clearing existing data...');
  await client.query('DELETE FROM railway_parts');
  await client.query('DELETE FROM stations');

  let stationsCount = 0;
  let partsCount = 0;

  // Process file in streaming fashion to avoid memory issues
  console.log('Reading GeoJSON file...');
  const fileContent = fs.readFileSync(geojsonPath, 'utf8');
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

  console.log(`Data loading completed successfully!`);
  console.log(`- Stations loaded: ${stationsCount}`);
  console.log(`- Railway parts loaded: ${partsCount}`);

  // Check if any split parts have changed geometry
  let geometryChanges = undefined;
  if (oldSplitGeometries.size > 0) {
    console.log('');
    console.log('Checking for geometry changes in split parts...');

    const changedPartIds: string[] = [];

    for (const [partId, oldGeometry] of oldSplitGeometries.entries()) {
      // Check if part still exists and if geometry changed
      const result = await client.query(`
        SELECT ST_AsText(geometry) as new_geometry
        FROM railway_parts
        WHERE id = $1
      `, [partId]);

      if (result.rows.length === 0) {
        // Part no longer exists in new data
        console.log(`⚠️  Part ${partId} (had split) no longer exists in new data`);
        changedPartIds.push(partId);
      } else {
        const newGeometry = result.rows[0].new_geometry;
        if (newGeometry !== oldGeometry) {
          console.log(`⚠️  Part ${partId} geometry has changed`);
          changedPartIds.push(partId);
        }
      }
    }

    if (changedPartIds.length > 0) {
      console.log(`Found ${changedPartIds.length} split parts with geometry changes`);
      console.log('Marking affected routes as invalid...');

      // Mark routes that use these parts as invalid
      const updateResult = await client.query(`
        UPDATE railway_routes
        SET
          is_valid = false,
          error_message = 'Split part geometry changed during map data update. Please re-split and recreate route.'
        WHERE starting_part_id::TEXT = ANY($1)
           OR ending_part_id::TEXT = ANY($1)
        RETURNING track_id
      `, [changedPartIds]);

      const affectedRoutes = updateResult.rows.length;
      console.log(`Marked ${affectedRoutes} routes as invalid due to split geometry changes`);

      geometryChanges = {
        changedPartIds,
        affectedRoutes
      };
    } else {
      console.log('No geometry changes detected in split parts');
    }
  }

  return { stationsCount, partsCount, geometryChanges };
}
