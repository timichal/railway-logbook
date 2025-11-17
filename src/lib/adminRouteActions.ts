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
    SELECT track_id, from_station, to_station, track_number, description, usage_type,
           starting_part_id, ending_part_id, is_valid, error_message
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
    SELECT track_id, from_station, to_station, track_number, description, usage_type, frequency, link,
           ST_AsGeoJSON(geometry) as geometry, length_km,
           starting_part_id, ending_part_id, is_valid, error_message
    FROM railway_routes
    WHERE track_id = $1
  `, [trackId]);

  if (result.rows.length === 0) {
    throw new Error('Route not found');
  }

  return result.rows[0];
}

/**
 * Get all railway routes with geometry (for map display)
 */
export async function getAllRailwayRoutesWithGeometry(): Promise<GeoJSONFeatureCollection> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await query(`
    SELECT track_id, from_station, to_station, track_number, description, usage_type,
           ST_AsGeoJSON(geometry) as geometry,
           starting_part_id, ending_part_id, is_valid, error_message
    FROM railway_routes
    ORDER BY from_station, to_station
  `);

  const features: GeoJSONFeature[] = result.rows.map(row => ({
    type: 'Feature' as const,
    geometry: JSON.parse(row.geometry),
    properties: {
      track_id: row.track_id,
      name: `${row.from_station} ⟷ ${row.to_station}`,
      description: row.description ?? undefined,
      usage: row.usage_type,
      starting_part_id: row.starting_part_id,
      ending_part_id: row.ending_part_id,
      is_valid: row.is_valid,
      error_message: row.error_message ?? undefined
    }
  }));

  return {
    type: 'FeatureCollection',
    features
  };
}

/**
 * Create a new route OR update existing route geometry
 * @param trackId - If provided, updates geometry only. If omitted, creates new route.
 */
export async function saveRailwayRoute(
  routeData: SaveRouteData,
  pathResult: PathResult,
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

    let sortedCoordinates: Coord[];

    // If we have railway parts with individual coordinates, sort them properly
    if (railwayParts && railwayParts.length > 0) {
      console.log('Using railway parts for coordinate sorting');

      // Extract coordinate lists from each railway part
      const coordinateLists: Coord[][] = railwayParts
        .filter(part => part.geometry && part.geometry.type === 'LineString')
        .map(part => part.geometry.coordinates as Coord[]);

      console.log('Extracted', coordinateLists.length, 'coordinate lists');

      try {
        // Use the mergeLinearChain function to properly sort and connect coordinates
        sortedCoordinates = mergeLinearChain(coordinateLists);
        console.log('Successfully sorted coordinates, result:', sortedCoordinates.length, 'points');
      } catch (error) {
        console.warn('Coordinate sorting failed, falling back to path result coordinates:', error);
        sortedCoordinates = pathResult.coordinates;
      }
    } else {
      console.log('No railway parts available, using path result coordinates');
      sortedCoordinates = pathResult.coordinates;
    }

    // Create LineString geometry from sorted coordinates
    const geometryWKT = coordinatesToWKT(sortedCoordinates);

    // Determine countries from route geometry
    const { startCountry, endCountry } = getRouteCountries({ type: 'LineString', coordinates: sortedCoordinates });
    console.log('Route countries:', startCountry, '→', endCountry);

    // Get starting and ending part IDs from the path
    const startingPartId = pathResult.partIds.length > 0 ? pathResult.partIds[0] : null;
    const endingPartId = pathResult.partIds.length > 0 ? pathResult.partIds[pathResult.partIds.length - 1] : null;

    let queryStr: string;
    let values: (string | number | string[] | null)[];

    if (trackId) {
      // Update existing route - only update geometry, length, part IDs, countries, and validity
      // Keep name, description, usage_type unchanged
      queryStr = `
        UPDATE railway_routes
        SET
          geometry = ST_GeomFromText($1, 4326),
          length_km = ST_Length(ST_GeomFromText($1, 4326)::geography) / 1000,
          start_country = $2,
          end_country = $3,
          starting_part_id = $4,
          ending_part_id = $5,
          is_valid = TRUE,
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE track_id = $6
        RETURNING track_id, length_km
      `;

      values = [
        geometryWKT,
        startCountry,
        endCountry,
        startingPartId,
        endingPartId,
        trackId
      ];
    } else {
      // Insert new route with auto-generated track_id
      queryStr = `
        INSERT INTO railway_routes (
          from_station,
          to_station,
          track_number,
          description,
          usage_type,
          frequency,
          link,
          geometry,
          length_km,
          start_country,
          end_country,
          starting_part_id,
          ending_part_id,
          is_valid
        ) VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          ST_GeomFromText($8, 4326),
          ST_Length(ST_GeomFromText($8, 4326)::geography) / 1000,
          $9,
          $10,
          $11,
          $12,
          TRUE
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
        geometryWKT,
        startCountry,
        endCountry,
        startingPartId,
        endingPartId
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
    console.log('Stored part IDs:', startingPartId, 'to', endingPartId);
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
  link: string | null
) {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  await query(`
    UPDATE railway_routes
    SET from_station = $2, to_station = $3, track_number = $4, description = $5, usage_type = $6, frequency = $7, link = $8,
        is_valid = TRUE, error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE track_id = $1
  `, [trackId, fromStation, toStation, trackNumber, description, usageType, frequency || [], link]);
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
