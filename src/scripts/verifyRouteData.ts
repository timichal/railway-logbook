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
  errors: Array<{ track_number: string; from_station: string; to_station: string; error: string }>;
}

/**
 * Recalculate a single railway route based on starting and ending part IDs
 */
export async function recalculateRoute(
  client: Client,
  trackId: number,
  startingPartId: string,
  endingPartId: string
): Promise<{ success: boolean; coordinates?: Coord[]; error?: string }> {
  try {
    const pathFinder = new RailwayPathFinder();
    const result = await pathFinder.findPathWithRetry(client, startingPartId, endingPartId);

    if (!result) {
      return { success: false, error: 'No path found between starting and ending parts' };
    }

    // Fetch the actual railway part geometries from the database
    // Handle both regular part IDs and split segment IDs (e.g., "12345_seg0")
    const coordinateLists: Coord[][] = [];

    for (const partId of result.partIds) {
      // Check if this is a segment ID
      const segmentMatch = partId.match(/^(\d+)_seg([01])$/);

      if (segmentMatch) {
        // Extract segment geometry from split metadata
        const originalPartId = segmentMatch[1];
        const segmentIndex = parseInt(segmentMatch[2]);

        const splitQuery = await client.query(`
          SELECT
            ST_AsGeoJSON(rp.geometry) as part_geometry_json,
            s.split_fraction,
            ST_AsGeoJSON(s.split_coordinate) as split_coordinate_json
          FROM railway_part_splits s
          JOIN railway_parts rp ON rp.id = s.part_id
          WHERE s.part_id = $1
        `, [originalPartId]);

        if (splitQuery.rows.length > 0) {
          const row = splitQuery.rows[0];
          const partGeom = JSON.parse(row.part_geometry_json);
          const splitFraction = parseFloat(row.split_fraction);
          const splitCoord = JSON.parse(row.split_coordinate_json);

          if (partGeom.type === 'LineString') {
            const coordinates = partGeom.coordinates as Coord[];
            const splitCoordinate = splitCoord.coordinates as Coord;

            // Calculate split index
            const totalPoints = coordinates.length - 1;
            const splitIndex = Math.floor(splitFraction * totalPoints);

            // Extract the correct segment
            if (segmentIndex === 0) {
              // Segment 0: from start to split point
              const seg0Coords = coordinates.slice(0, splitIndex + 1);
              seg0Coords.push(splitCoordinate);
              coordinateLists.push(seg0Coords);
            } else {
              // Segment 1: from split point to end
              const seg1Coords = [splitCoordinate, ...coordinates.slice(splitIndex + 1)];
              coordinateLists.push(seg1Coords);
            }
          }
        }
      } else {
        // Regular part ID - fetch from railway_parts
        const partQuery = await client.query(`
          SELECT ST_AsGeoJSON(geometry) as geometry_json
          FROM railway_parts
          WHERE id = $1
        `, [partId]);

        if (partQuery.rows.length > 0) {
          const geom = JSON.parse(partQuery.rows[0].geometry_json);
          if (geom.type === 'LineString') {
            coordinateLists.push(geom.coordinates as Coord[]);
          }
        }
      }
    }

    let sortedCoordinates: Coord[];

    if (coordinateLists.length > 0) {
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
export async function recalculateAllRoutes(client: Client): Promise<RecalculationResult> {
  console.log('Recalculating all railway routes...');

  const result: RecalculationResult = {
    totalRoutes: 0,
    successfulRoutes: 0,
    invalidRoutes: 0,
    errors: []
  };

  // Get all routes with starting and ending part IDs
  const routes = await client.query(`
    SELECT track_id, track_number, from_station, to_station, starting_part_id, ending_part_id, length_km
    FROM railway_routes
    WHERE starting_part_id IS NOT NULL
      AND ending_part_id IS NOT NULL
    ORDER BY track_id
  `);

  result.totalRoutes = routes.rows.length;
  console.log(`Found ${result.totalRoutes} routes to recalculate`);

  for (const route of routes.rows) {
    const { track_id, track_number, from_station, to_station, starting_part_id, ending_part_id, length_km } = route;
    const originalLength = parseFloat(length_km);

    const recalcResult = await recalculateRoute(
      client,
      track_id,
      String(starting_part_id),
      String(ending_part_id)
    );

    if (recalcResult.success && recalcResult.coordinates) {
      // Convert coordinates to LineString WKT format using shared utility
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
    WHERE starting_part_id IS NOT NULL
      AND ending_part_id IS NOT NULL
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
  console.log(`Invalid routes: ${recalcResult.invalidRoutes}`);

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
