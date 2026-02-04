'use server';

import pool from './db';
import { query } from './db';
import { getUser } from './authActions';
import { GeoJSONFeatureCollection, GeoJSONFeature, PathResult, RailwayPart } from './types';
import { mergeLinearChain, coordinatesToWKT, type Coord } from './coordinateUtils';
import { getRouteCountries } from './countryUtils';
import type { UsageType } from './constants';

/**
 * Interface for route metadata used during creation
 */
export interface SaveRouteData {
  from_station: string;
  to_station: string;
  track_number: string;
  description: string;
  usage_type: UsageType;
  frequency: string[];
  link: string;
  scenic: boolean;
  hsl: boolean;
  intended_backtracking: boolean;
}

/**
 * Get all railway routes (list view, no geometry)
 */
export async function getAllRailwayRoutes() {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await query(`
    SELECT track_id, from_station, to_station, track_number, description, usage_type, scenic, hsl,
           starting_part_id, ending_part_id, is_valid, error_message, intended_backtracking, has_backtracking
    FROM railway_routes
    ORDER BY from_station, to_station
  `);

  return result.rows;
}

/**
 * Get a single railway route by track_id
 */
export async function getRailwayRoute(trackId: string) {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await query(`
    SELECT track_id, from_station, to_station, track_number, description, usage_type, frequency, link, scenic, hsl,
           ST_AsGeoJSON(geometry) as geometry, length_km,
           ST_AsGeoJSON(starting_coordinate) as starting_coordinate_json,
           ST_AsGeoJSON(ending_coordinate) as ending_coordinate_json,
           starting_part_id, ending_part_id, is_valid, error_message, intended_backtracking
    FROM railway_routes
    WHERE track_id = $1
  `, [trackId]);

  if (result.rows.length === 0) {
    throw new Error('Route not found');
  }

  const row = result.rows[0];

  // Parse coordinate JSON if they exist
  let startingCoordinate = null;
  let endingCoordinate = null;

  if (row.starting_coordinate_json) {
    const geojson = JSON.parse(row.starting_coordinate_json);
    if (geojson.type === 'Point' && geojson.coordinates) {
      startingCoordinate = geojson.coordinates as [number, number];
    }
  }

  if (row.ending_coordinate_json) {
    const geojson = JSON.parse(row.ending_coordinate_json);
    if (geojson.type === 'Point' && geojson.coordinates) {
      endingCoordinate = geojson.coordinates as [number, number];
    }
  }

  return {
    ...row,
    starting_coordinate: startingCoordinate,
    ending_coordinate: endingCoordinate
  };
}

/**
 * Get all route endpoints (starting and ending coordinates) for map display
 * Returns GeoJSON FeatureCollection of Point features
 */
export async function getAllRouteEndpoints(): Promise<GeoJSONFeatureCollection> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await query(`
    SELECT
      track_id,
      from_station,
      to_station,
      ST_AsGeoJSON(starting_coordinate) as starting_coordinate_json,
      ST_AsGeoJSON(ending_coordinate) as ending_coordinate_json
    FROM railway_routes
    WHERE starting_coordinate IS NOT NULL AND ending_coordinate IS NOT NULL
  `);

  const features: GeoJSONFeature[] = [];

  for (const row of result.rows) {
    // Parse starting coordinate
    if (row.starting_coordinate_json) {
      const geojson = JSON.parse(row.starting_coordinate_json);
      if (geojson.type === 'Point' && geojson.coordinates) {
        features.push({
          type: 'Feature' as const,
          geometry: geojson,
          properties: {
            track_id: row.track_id,
            endpoint_type: 'start',
            station_name: row.from_station,
            route_name: `${row.from_station} ⟷ ${row.to_station}`
          }
        });
      }
    }

    // Parse ending coordinate
    if (row.ending_coordinate_json) {
      const geojson = JSON.parse(row.ending_coordinate_json);
      if (geojson.type === 'Point' && geojson.coordinates) {
        features.push({
          type: 'Feature' as const,
          geometry: geojson,
          properties: {
            track_id: row.track_id,
            endpoint_type: 'end',
            station_name: row.to_station,
            route_name: `${row.from_station} ⟷ ${row.to_station}`
          }
        });
      }
    }
  }

  return {
    type: 'FeatureCollection',
    features
  };
}

/**
 * Create a new route OR update existing route geometry
 * @param trackId - If provided, updates geometry only. If omitted, creates new route.
 * @param startCoordinate - Exact start coordinate [lng, lat]
 * @param endCoordinate - Exact end coordinate [lng, lat]
 */
export async function saveRailwayRoute(
  routeData: SaveRouteData,
  pathResult: PathResult,
  startCoordinate: [number, number],
  endCoordinate: [number, number],
  railwayParts?: RailwayPart[],
  trackId?: string
): Promise<string> {
  // Admin check
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const client = await pool.connect();

  try {
    console.log('Saving railway route:', `${routeData.from_station} ⟷ ${routeData.to_station}`);
    console.log('Path segments:', pathResult.partIds.length);
    console.log('Start coordinate:', startCoordinate);
    console.log('End coordinate:', endCoordinate);

    // Use the truncated/merged coordinates from pathResult
    // The pathfinder already handles truncation and merging correctly
    const sortedCoordinates = pathResult.coordinates;
    console.log('Using pathfinder coordinates:', sortedCoordinates.length, 'points');

    // Create LineString geometry from coordinates
    const geometryWKT = coordinatesToWKT(sortedCoordinates);

    // Create POINT WKT for start and end coordinates
    const startPointWKT = `POINT(${startCoordinate[0]} ${startCoordinate[1]})`;
    const endPointWKT = `POINT(${endCoordinate[0]} ${endCoordinate[1]})`;

    // Determine countries from route geometry
    const { startCountry, endCountry } = getRouteCountries({ type: 'LineString', coordinates: sortedCoordinates });
    console.log('Route countries:', startCountry, '→', endCountry);
    console.log('Has backtracking:', pathResult.hasBacktracking || false);

    let queryStr: string;
    let values: (string | number | string[] | boolean | null)[];

    if (trackId) {
      // Update existing route - only update geometry, length, coordinates, countries, validity, and backtracking flag
      // Keep name, description, usage_type unchanged
      // Set part_id fields to NULL (deprecated)
      queryStr = `
        UPDATE railway_routes
        SET
          geometry = ST_GeomFromText($1, 4326),
          length_km = ST_Length(ST_GeomFromText($1, 4326)::geography) / 1000,
          start_country = $2,
          end_country = $3,
          starting_coordinate = ST_GeomFromText($4, 4326),
          ending_coordinate = ST_GeomFromText($5, 4326),
          starting_part_id = NULL,
          ending_part_id = NULL,
          has_backtracking = $6,
          is_valid = TRUE,
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE track_id = $7
        RETURNING track_id, length_km
      `;

      values = [
        geometryWKT,
        startCountry,
        endCountry,
        startPointWKT,
        endPointWKT,
        pathResult.hasBacktracking || false,
        trackId
      ];
    } else {
      // Insert new route with auto-generated track_id
      // Set part_id fields to NULL (deprecated)
      queryStr = `
        INSERT INTO railway_routes (
          from_station,
          to_station,
          track_number,
          description,
          usage_type,
          frequency,
          link,
          scenic,
          hsl,
          geometry,
          length_km,
          start_country,
          end_country,
          starting_coordinate,
          ending_coordinate,
          starting_part_id,
          ending_part_id,
          is_valid,
          intended_backtracking,
          has_backtracking
        ) VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          ST_GeomFromText($10, 4326),
          ST_Length(ST_GeomFromText($10, 4326)::geography) / 1000,
          $11,
          $12,
          ST_GeomFromText($13, 4326),
          ST_GeomFromText($14, 4326),
          NULL,
          NULL,
          TRUE,
          $15,
          $16
        )
        RETURNING track_id, length_km
      `;

      values = [
        routeData.from_station,
        routeData.to_station,
        routeData.track_number || null,
        routeData.description || null,
        routeData.usage_type,
        routeData.frequency || [],
        routeData.link || null,
        routeData.scenic,
        routeData.hsl,
        geometryWKT,
        startCountry,
        endCountry,
        startPointWKT,
        endPointWKT,
        routeData.intended_backtracking,
        pathResult.hasBacktracking || false
      ];
    }

    const result = await client.query(queryStr, values);
    const savedTrackId = result.rows[0].track_id;
    const lengthKm = result.rows[0].length_km;

    if (trackId) {
      console.log('Successfully updated railway route geometry:', trackId);
    } else {
      console.log('Successfully saved railway route with auto-generated track_id:', savedTrackId);
    }
    console.log('Final geometry has', sortedCoordinates.length, 'coordinate points');
    console.log('Calculated route length:', lengthKm ? `${Math.round(lengthKm * 10) / 10} km` : 'N/A');
    console.log('Stored coordinates:', startCoordinate, 'to', endCoordinate);
    return String(savedTrackId);

  } catch (error) {
    console.error('Error saving railway route:', error);
    throw new Error(`Failed to save route: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    client.release();
  }
}

/**
 * Update route metadata (name, description, usage_type, etc.)
 * Also marks route as valid since admin is manually validating
 */
export async function updateRailwayRoute(
  trackId: string,
  fromStation: string,
  toStation: string,
  trackNumber: string | null,
  description: string | null,
  usageType: UsageType,
  frequency: string[],
  link: string | null,
  scenic: boolean,
  hsl: boolean,
  intendedBacktracking: boolean
) {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  await query(`
    UPDATE railway_routes
    SET from_station = $2, to_station = $3, track_number = $4, description = $5, usage_type = $6, frequency = $7, link = $8,
        scenic = $9, hsl = $10, intended_backtracking = $11, is_valid = TRUE, error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE track_id = $1
  `, [trackId, fromStation, toStation, trackNumber, description, usageType, frequency || [], link, scenic, hsl, intendedBacktracking]);
}

/**
 * Delete a railway route
 */
export async function deleteRailwayRoute(trackId: string): Promise<void> {
  // Admin check
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const client = await pool.connect();

  try {
    console.log('Deleting railway route with track_id:', trackId);

    // Delete from railway_routes table (CASCADE will handle user_trips)
    const deleteQuery = 'DELETE FROM railway_routes WHERE track_id = $1';
    const result = await client.query(deleteQuery, [trackId]);

    if (result.rowCount === 0) {
      throw new Error(`Route with track_id ${trackId} not found`);
    }

    console.log('Successfully deleted railway route:', trackId);

  } catch (error) {
    console.error('Error deleting railway route:', error);
    throw new Error(`Failed to delete route: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    client.release();
  }
}
