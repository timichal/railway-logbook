import { Client } from 'pg';
import dotenv from 'dotenv';
import { RailwayPathFinder } from './lib/railwayPathFinder';
import { mergeLinearChain, coordinatesToWKT, type Coord } from '../lib/coordinateUtils';
import { getDbConfig } from '../lib/dbConfig';

dotenv.config();

// Get database config after dotenv loads environment variables
const dbConfig = getDbConfig();

export interface RecalculationResult {
  totalRoutes: number;
  successfulRoutes: number;
  invalidRoutes: number;
  backtrackingRoutes: Array<{ track_number: string; from_station: string; to_station: string }>;
  errors: Array<{ track_number: string; from_station: string; to_station: string; error: string }>;
}

/**
 * Recalculate a single railway route based on starting and ending coordinates
 */
export async function recalculateRoute(
  client: Client,
  trackId: number,
  startingCoordinate: [number, number],
  endingCoordinate: [number, number]
): Promise<{ success: boolean; coordinates?: Coord[]; error?: string; hasBacktracking?: boolean }> {
  const pathFinder = new RailwayPathFinder();

  // Capture console output to detect backtracking
  let hasBacktracking = false;
  const originalLog = console.log;

  try {
    console.log = (...args: any[]) => {
      const message = args.join(' ');
      if (message.includes('using backtracking path instead')) {
        hasBacktracking = true;
      }
      // Suppress output during pathfinding
    };

    const result = await pathFinder.findPathFromCoordinates(
      client,
      startingCoordinate,
      endingCoordinate
    );

    if (!result) {
      return { success: false, error: 'No path found between starting and ending coordinates' };
    }

    return { success: true, coordinates: result.coordinates, hasBacktracking };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during recalculation'
    };
  } finally {
    // Always restore console.log
    console.log = originalLog;
  }
}

/**
 * Recalculate all railway routes based on stored coordinates
 */
export async function recalculateAllRoutes(client: Client): Promise<RecalculationResult> {
  console.log('Recalculating all railway routes...');

  const result: RecalculationResult = {
    totalRoutes: 0,
    successfulRoutes: 0,
    invalidRoutes: 0,
    backtrackingRoutes: [],
    errors: []
  };

  // Get all routes with coordinates, part IDs, and full geometry
  // Skip routes that are already marked as invalid
  const routes = await client.query(`
    SELECT
      track_id,
      track_number,
      from_station,
      to_station,
      starting_part_id,
      ending_part_id,
      ST_X(starting_coordinate) as start_lng,
      ST_Y(starting_coordinate) as start_lat,
      ST_X(ending_coordinate) as end_lng,
      ST_Y(ending_coordinate) as end_lat,
      ST_AsGeoJSON(geometry) as geometry_json,
      length_km
    FROM railway_routes
    WHERE starting_coordinate IS NOT NULL
      AND ending_coordinate IS NOT NULL
      AND (is_valid IS NULL OR is_valid = TRUE)
    ORDER BY track_id
  `);

  result.totalRoutes = routes.rows.length;
  console.log(`Found ${result.totalRoutes} routes to recalculate`);

  for (const route of routes.rows) {
    const { track_id, track_number, from_station, to_station, starting_part_id, ending_part_id, start_lng, start_lat, end_lng, end_lat, geometry_json, length_km } = route;
    const originalLength = parseFloat(length_km);

    const startingCoordinate: [number, number] = [parseFloat(start_lng), parseFloat(start_lat)];
    const endingCoordinate: [number, number] = [parseFloat(end_lng), parseFloat(end_lat)];

    // Recalculate route from coordinates
    const recalcResult = await recalculateRoute(
      client,
      track_id,
      startingCoordinate,
      endingCoordinate
    );

    if (recalcResult.success && recalcResult.coordinates) {
      // Convert coordinates to LineString WKT format
      const lineString = coordinatesToWKT(recalcResult.coordinates);

      // Calculate the new length
      const lengthQuery = await client.query(`
        SELECT ST_Length(ST_GeomFromText($1, 4326)::geography) / 1000 as new_length_km
      `, [lineString]);

      const newLength = parseFloat(lengthQuery.rows[0].new_length_km);
      const lengthDiff = Math.abs(newLength - originalLength);
      const lengthDiffPercent = (lengthDiff / originalLength) * 100;

      // Check if the new length differs significantly from the original
      // Consider invalid if difference is more than 0.1 km OR more than 1%
      if (lengthDiff > 0.1 && lengthDiffPercent > 1) {
        const errorMsg = `Distance mismatch: original ${originalLength.toFixed(2)} km, recalculated ${newLength.toFixed(2)} km (diff: ${lengthDiff.toFixed(2)} km, ${lengthDiffPercent.toFixed(1)}%)`;

        console.log(`  [${track_number}] ${from_station} → ${to_station}: ${errorMsg}`);

        // Mark route as invalid due to distance mismatch
        await client.query(`
          UPDATE railway_routes
          SET
            is_valid = FALSE,
            error_message = $1,
            updated_at = CURRENT_TIMESTAMP
          WHERE track_id = $2
        `, [errorMsg, track_id]);

        result.invalidRoutes++;
        result.errors.push({
          track_number,
          from_station,
          to_station,
          error: errorMsg
        });
      } else {
        // Update route with new geometry
        await client.query(`
          UPDATE railway_routes
          SET
            geometry = ST_GeomFromText($1, 4326),
            length_km = $2,
            is_valid = TRUE,
            error_message = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE track_id = $3
        `, [lineString, newLength, track_id]);

        result.successfulRoutes++;

        // Track routes that used backtracking
        if (recalcResult.hasBacktracking) {
          result.backtrackingRoutes.push({
            track_number,
            from_station,
            to_station
          });
        }

        if (result.successfulRoutes % 100 === 0) {
          console.log(`  Recalculated ${result.successfulRoutes}/${result.totalRoutes} routes...`);
        }
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
        track_number,
        from_station,
        to_station,
        error: recalcResult.error || 'Unknown error'
      });
    }
  }

  return result;
}

/**
 * Verify and recalculate routes if they exist in the database
 * Prints summary information to console
 */
export async function verifyAndRecalculateRoutes(client: Client): Promise<void> {
  // Check if there are routes to recalculate
  const routeCount = await client.query(`
    SELECT COUNT(*) as count
    FROM railway_routes
    WHERE starting_coordinate IS NOT NULL
      AND ending_coordinate IS NOT NULL
  `);

  const hasRoutes = parseInt(routeCount.rows[0].count) > 0;

  if (!hasRoutes) {
    console.log('');
    console.log('No routes found - skipping recalculation');
    return;
  }

  console.log('');
  // Recalculate all railway routes
  const recalcResult = await recalculateAllRoutes(client);

  console.log('');
  console.log('=== Route Recalculation Summary ===');
  console.log(`Total routes: ${recalcResult.totalRoutes}`);
  console.log(`Successfully recalculated: ${recalcResult.successfulRoutes}`);
  console.log(`Routes with backtracking: ${recalcResult.backtrackingRoutes.length}`);
  console.log(`Invalid routes: ${recalcResult.invalidRoutes}`);

  if (recalcResult.backtrackingRoutes.length > 0) {
    console.log('');
    console.log('=== Routes Using Backtracking Path ===');
    for (const route of recalcResult.backtrackingRoutes) {
      console.log(`  [${route.track_number}] ${route.from_station} → ${route.to_station}`);
    }
  }

  if (recalcResult.errors.length > 0) {
    console.log('');
    console.log('=== Invalid Routes ===');
    for (const error of recalcResult.errors) {
      console.log(`  [${error.track_number}] ${error.from_station} → ${error.to_station}: ${error.error}`);
    }
  }
}

async function verifyRoutes(): Promise<void> {
  const client = new Client(dbConfig);

  try {
    await client.connect();
    console.log('Connected to database');

    await verifyAndRecalculateRoutes(client);

    console.log('');
    console.log('Route verification completed!');

  } catch (error) {
    console.error('Error verifying routes:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the script only if executed directly (not imported)
// Check if this file is being run directly by tsx
const isMainModule = process.argv[1]?.endsWith('verifyRouteData.ts') || process.argv[1]?.endsWith('verifyRouteData.js');
if (isMainModule) {
  verifyRoutes().catch(console.error);
}
