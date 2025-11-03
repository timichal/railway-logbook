'use server';

import pool from './db';
import { getUser } from './auth-actions';
import type { PathResult, RailwayPart } from './types';
import { mergeLinearChain, coordinatesToWKT, type Coord } from './coordinate-utils';
import type { UsageType } from './constants';

export interface SaveRouteData {
  from_station: string;
  to_station: string;
  track_number: string;
  description: string;
  usage_type: UsageType;
  frequency: string[]; // Array of frequency tags
  link: string; // External URL/link
}

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
    
    // Get starting and ending part IDs from the path
    const startingPartId = pathResult.partIds.length > 0 ? pathResult.partIds[0] : null;
    const endingPartId = pathResult.partIds.length > 0 ? pathResult.partIds[pathResult.partIds.length - 1] : null;

    let query: string;
    let values: (string | number | string[] | null)[];

    if (trackId) {
      // Update existing route - only update geometry, length, part IDs, and validity
      // Keep name, description, usage_type unchanged
      query = `
        UPDATE railway_routes
        SET
          geometry = ST_GeomFromText($1, 4326),
          length_km = ST_Length(ST_GeomFromText($1, 4326)::geography) / 1000,
          starting_part_id = $2,
          ending_part_id = $3,
          is_valid = TRUE,
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE track_id = $4
        RETURNING track_id, length_km
      `;

      values = [
        geometryWKT,
        startingPartId,
        endingPartId,
        trackId
      ];
    } else {
      // Insert new route with auto-generated track_id
      query = `
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
        startingPartId,
        endingPartId
      ];
    }

    const result = await client.query(query, values);
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