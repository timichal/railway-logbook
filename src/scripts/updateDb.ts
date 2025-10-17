import { Client } from 'pg';
import dotenv from 'dotenv';
import { loadStationsAndParts } from './lib/loadRailwayData';
import { RailwayPathFinder } from './lib/railwayPathFinder';
import { mergeLinearChain, coordinatesToWKT, type Coord } from '../lib/coordinate-utils';

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

interface RecalculationResult {
  totalRoutes: number;
  successfulRoutes: number;
  invalidRoutes: number;
  errors: Array<{ track_id: number; name: string; error: string }>;
}

/**
 * Recalculate a single railway route based on starting and ending part IDs
 */
async function recalculateRoute(
  client: Client,
  trackId: number,
  startingPartId: string,
  endingPartId: string
): Promise<{ success: boolean; coordinates?: Coord[]; error?: string }> {
  try {
    const pathFinder = new RailwayPathFinder();
    await pathFinder.loadRailwayParts(client, startingPartId, endingPartId);

    const result = pathFinder.findPath(startingPartId, endingPartId);

    if (!result) {
      return { success: false, error: 'No path found between starting and ending parts' };
    }

    // Fetch the actual railway part geometries from the database
    const railwayPartsQuery = await client.query(`
      SELECT id, ST_AsGeoJSON(geometry) as geometry_json
      FROM railway_parts
      WHERE id = ANY($1)
      ORDER BY array_position($1, id)
    `, [result.partIds]);

    let sortedCoordinates: Coord[];

    if (railwayPartsQuery.rows.length > 0) {
      // Extract coordinate lists from each railway part
      const coordinateLists: Coord[][] = railwayPartsQuery.rows
        .map(row => {
          const geom = JSON.parse(row.geometry_json);
          return geom.type === 'LineString' ? geom.coordinates as Coord[] : null;
        })
        .filter((coords): coords is Coord[] => coords !== null);

      try {
        // Use the mergeLinearChain function to properly sort and connect coordinates
        sortedCoordinates = mergeLinearChain(coordinateLists);
        console.log(`  Successfully sorted ${sortedCoordinates.length} coordinates for route ${trackId}`);
      } catch (error) {
        console.warn(`  Coordinate sorting failed for route ${trackId}, falling back to path result coordinates:`, error);
        sortedCoordinates = result.coordinates;
      }
    } else {
      // No railway parts found, use path result coordinates
      sortedCoordinates = result.coordinates;
    }

    return { success: true, coordinates: sortedCoordinates };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during recalculation'
    };
  }
}

/**
 * Recalculate all railway routes based on stored part IDs
 */
async function recalculateAllRoutes(client: Client): Promise<RecalculationResult> {
  console.log('Recalculating all railway routes...');

  const result: RecalculationResult = {
    totalRoutes: 0,
    successfulRoutes: 0,
    invalidRoutes: 0,
    errors: []
  };

  // Get all routes with starting and ending part IDs
  const routes = await client.query(`
    SELECT track_id, name, starting_part_id, ending_part_id
    FROM railway_routes
    WHERE starting_part_id IS NOT NULL
      AND ending_part_id IS NOT NULL
    ORDER BY track_id
  `);

  result.totalRoutes = routes.rows.length;
  console.log(`Found ${result.totalRoutes} routes to recalculate`);

  for (const route of routes.rows) {
    const { track_id, name, starting_part_id, ending_part_id } = route;

    const recalcResult = await recalculateRoute(
      client,
      track_id,
      String(starting_part_id),
      String(ending_part_id)
    );

    if (recalcResult.success && recalcResult.coordinates) {
      // Convert coordinates to LineString WKT format using shared utility
      const lineString = coordinatesToWKT(recalcResult.coordinates);

      // Update route with new geometry
      await client.query(`
        UPDATE railway_routes
        SET
          geometry = ST_GeomFromText($1, 4326),
          length_km = ST_Length(ST_GeomFromText($1, 4326)::geography) / 1000,
          is_valid = TRUE,
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE track_id = $2
      `, [lineString, track_id]);

      result.successfulRoutes++;

      if (result.successfulRoutes % 100 === 0) {
        console.log(`  Recalculated ${result.successfulRoutes}/${result.totalRoutes} routes...`);
      }
    } else {
      // Mark route as invalid
      await client.query(`
        UPDATE railway_routes
        SET
          is_valid = FALSE,
          error_message = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE track_id = $2
      `, [recalcResult.error, track_id]);

      result.invalidRoutes++;
      result.errors.push({
        track_id,
        name,
        error: recalcResult.error || 'Unknown error'
      });
    }
  }

  return result;
}

async function updateDatabase(): Promise<void> {
  const client = new Client(dbConfig);

  try {
    await client.connect();
    console.log('Connected to database');

    // Step 1: Reload stations and railway parts from pruned GeoJSON
    const prunedDataPath = './data/czech-republic-pruned-251016.geojson';
    await loadStationsAndParts(client, prunedDataPath);

    // Step 2: Recalculate all railway routes
    const recalcResult = await recalculateAllRoutes(client);

    console.log('');
    console.log('=== Route Recalculation Summary ===');
    console.log(`Total routes: ${recalcResult.totalRoutes}`);
    console.log(`Successfully recalculated: ${recalcResult.successfulRoutes}`);
    console.log(`Invalid routes: ${recalcResult.invalidRoutes}`);

    if (recalcResult.errors.length > 0) {
      console.log('');
      console.log('=== Invalid Routes ===');
      for (const error of recalcResult.errors) {
        console.log(`  [${error.track_id}] ${error.name}: ${error.error}`);
      }
    }

    console.log('');
    console.log('Database update completed!');

  } catch (error) {
    console.error('Error updating database:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the script
updateDatabase().catch(console.error);
