#!/usr/bin/env tsx
/**
 * Complete migration to coordinate-based routes
 *
 * This script:
 * 1. Adds coordinate columns to railway_routes table
 * 2. Migrates existing routes to use coordinates
 * 3. Verifies all routes have coordinates
 * 4. Updates vector tile functions
 * 5. Drops railway_part_splits table (no longer needed)
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function runCoordinateMigration() {
  const client = await pool.connect();

  try {
    console.log('========================================');
    console.log('Coordinate-Based Routes Migration');
    console.log('========================================\n');

    // Step 1: Apply schema changes
    console.log('Step 1: Adding coordinate columns to database...');
    console.log('--------------------------------------------');

    const schemaSQL = readFileSync(
      join(process.cwd(), 'database', 'migrations', '001_add_coordinate_columns.sql'),
      'utf-8'
    );

    await client.query(schemaSQL);
    console.log('✅ Schema changes applied successfully\n');

    // Step 2: Migrate existing routes to coordinates
    // Use vertices from the original starting/ending parts, not route geometry
    console.log('Step 2: Migrating existing routes to coordinates...');
    console.log('--------------------------------------------');

    const routes = await client.query(`
      SELECT
        track_id,
        from_station,
        to_station,
        starting_part_id,
        ending_part_id,
        ST_AsGeoJSON(geometry) as geometry_json
      FROM railway_routes
      WHERE geometry IS NOT NULL
        AND starting_part_id IS NOT NULL
        AND ending_part_id IS NOT NULL
      ORDER BY track_id
    `);

    let successCount = 0;
    let failCount = 0;
    const errors: Array<{ track_id: number; error: string }> = [];

    console.log(`Found ${routes.rowCount} routes to migrate\n`);

    for (const route of routes.rows) {
      const { track_id, from_station, to_station, starting_part_id, ending_part_id, geometry_json } = route;

      try {
        // Get the geometries of the starting and ending parts
        const startPartResult = await client.query(`
          SELECT ST_AsGeoJSON(geometry) as geometry_json
          FROM railway_parts
          WHERE id = $1
        `, [starting_part_id]);

        const endPartResult = await client.query(`
          SELECT ST_AsGeoJSON(geometry) as geometry_json
          FROM railway_parts
          WHERE id = $1
        `, [ending_part_id]);

        if (startPartResult.rows.length === 0) {
          throw new Error(`Starting part ${starting_part_id} not found`);
        }

        if (endPartResult.rows.length === 0) {
          throw new Error(`Ending part ${ending_part_id} not found`);
        }

        const startPartGeom = JSON.parse(startPartResult.rows[0].geometry_json);
        const endPartGeom = JSON.parse(endPartResult.rows[0].geometry_json);

        if (startPartGeom.type !== 'LineString' || !startPartGeom.coordinates || startPartGeom.coordinates.length < 2) {
          throw new Error('Starting part has invalid geometry');
        }

        if (endPartGeom.type !== 'LineString' || !endPartGeom.coordinates || endPartGeom.coordinates.length < 2) {
          throw new Error('Ending part has invalid geometry');
        }

        const geometry = JSON.parse(geometry_json);
        if (geometry.type !== 'LineString' || !geometry.coordinates || geometry.coordinates.length < 2) {
          throw new Error('Route has invalid geometry');
        }

        const routeCoordinates = geometry.coordinates as [number, number][];
        const routeStart = routeCoordinates[0];
        const routeEnd = routeCoordinates[routeCoordinates.length - 1];

        // For starting part: use the endpoint (first or last vertex) closest to route start
        // Routes always start/end at part endpoints, never in the middle
        const startPartCoords = startPartGeom.coordinates as [number, number][];
        const startPartFirst = startPartCoords[0];
        const startPartLast = startPartCoords[startPartCoords.length - 1];

        const distToFirst = Math.hypot(routeStart[0] - startPartFirst[0], routeStart[1] - startPartFirst[1]);
        const distToLast = Math.hypot(routeStart[0] - startPartLast[0], routeStart[1] - startPartLast[1]);

        const startingCoordinate = distToFirst < distToLast ? startPartFirst : startPartLast;

        // For ending part: use the endpoint (first or last vertex) closest to route end
        const endPartCoords = endPartGeom.coordinates as [number, number][];
        const endPartFirst = endPartCoords[0];
        const endPartLast = endPartCoords[endPartCoords.length - 1];

        const distToEndFirst = Math.hypot(routeEnd[0] - endPartFirst[0], routeEnd[1] - endPartFirst[1]);
        const distToEndLast = Math.hypot(routeEnd[0] - endPartLast[0], routeEnd[1] - endPartLast[1]);

        const endingCoordinate = distToEndFirst < distToEndLast ? endPartFirst : endPartLast;

        await client.query(`
          UPDATE railway_routes
          SET
            starting_coordinate = ST_GeomFromText($1, 4326),
            ending_coordinate = ST_GeomFromText($2, 4326),
            updated_at = CURRENT_TIMESTAMP
          WHERE track_id = $3
        `, [
          `POINT(${startingCoordinate[0]} ${startingCoordinate[1]})`,
          `POINT(${endingCoordinate[0]} ${endingCoordinate[1]})`,
          track_id
        ]);

        successCount++;

        if (successCount % 100 === 0) {
          console.log(`  Migrated ${successCount}/${routes.rowCount} routes...`);
        }

      } catch (error) {
        failCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ track_id, error: errorMessage });
        console.error(`  ❌ Failed to migrate route ${track_id} (${from_station} → ${to_station}): ${errorMessage}`);
      }
    }

    console.log(`\n✅ Successfully migrated: ${successCount} routes`);
    if (failCount > 0) {
      console.log(`⚠️  Failed migrations: ${failCount} routes`);
    }
    console.log('');

    // Step 3: Verify migration
    console.log('Step 3: Verifying migration...');
    console.log('--------------------------------------------');

    const verifyQuery = await client.query(`
      SELECT COUNT(*) as count
      FROM railway_routes
      WHERE geometry IS NOT NULL
        AND (starting_coordinate IS NULL OR ending_coordinate IS NULL)
    `);

    const unmigrated = parseInt(verifyQuery.rows[0].count);
    if (unmigrated > 0) {
      console.log(`⚠️  Warning: ${unmigrated} routes still have NULL coordinates`);
    } else {
      console.log('✅ All routes have coordinates');
    }
    console.log('');

    // Step 4: Update vector tile functions
    console.log('Step 4: Updating vector tile functions...');
    console.log('--------------------------------------------');

    const vectorTilesSQL = readFileSync(
      join(process.cwd(), 'database', 'init', '02-vector-tiles.sql'),
      'utf-8'
    );

    await client.query(vectorTilesSQL);
    console.log('✅ Vector tile functions updated successfully\n');

    // Step 5: Drop railway_part_splits table (no longer needed)
    console.log('Step 5: Dropping railway_part_splits table...');
    console.log('--------------------------------------------');

    const dropSplitsSQL = readFileSync(
      join(process.cwd(), 'database', 'migrations', '004-drop-railway-part-splits.sql'),
      'utf-8'
    );

    await client.query(dropSplitsSQL);
    console.log('✅ Railway part splits table dropped successfully\n');

    // Summary
    console.log('========================================');
    console.log('✅ Migration Complete!');
    console.log('========================================\n');

    console.log('Summary:');
    console.log(`  Total routes: ${routes.rowCount}`);
    console.log(`  Successfully migrated: ${successCount}`);
    console.log(`  Failed migrations: ${failCount}`);
    console.log(`  Routes without coordinates: ${unmigrated}\n`);

    if (errors.length > 0) {
      console.log('Errors:');
      errors.forEach(({ track_id, error }) => {
        console.log(`  Route ${track_id}: ${error}`);
      });
      console.log('');
    }

    console.log('Next steps:');
    console.log('1. Test creating new routes in admin interface');
    console.log('2. Run: npm run verifyRouteData');
    console.log('3. Complete remaining UI updates (see MIGRATION_TODO.md)\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
runCoordinateMigration().catch((error) => {
  console.error('Script error:', error);
  process.exit(1);
});
