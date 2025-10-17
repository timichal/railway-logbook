'use server';

import pool from './db';
import { getUser } from './auth-actions';
import type { PathResult } from './pathfinding-types';
import type { RailwayPart } from './types';

export interface SaveRouteData {
  name: string;
  description: string;
  usage_type: string;
}

type Coord = [number, number];

// Coordinate merging logic from mergeCoordinateLists.ts
function mergeLinearChain(sublists: Coord[][]): Coord[] {
  if (sublists.length === 0) return [];
  if (sublists.length === 1) return sublists[0];

  // Step 1: Create a map of coordinate frequencies
  const coordCount = new Map<string, number>();
  sublists.flat().forEach(([x, y]) => {
    const key = `${x},${y}`;
    coordCount.set(key, (coordCount.get(key) || 0) + 1);
  });

  // Step 2: Find the starting sublist
  const startingSublistIndex = sublists.findIndex(sublist => {
    const firstCoord = `${sublist[0][0]},${sublist[0][1]}`;
    const lastCoord = `${sublist[sublist.length - 1][0]},${sublist[sublist.length - 1][1]}`;
    return coordCount.get(firstCoord) === 1 || coordCount.get(lastCoord) === 1;
  });

  if (startingSublistIndex === -1) {
    throw new Error("No valid starting sublist found.");
  }

  // Extract the starting sublist
  const mergedChain = [...sublists[startingSublistIndex]];
  sublists.splice(startingSublistIndex, 1); // Remove the starting sublist

  // Step 2.1: Ensure the starting sublist is oriented correctly
  const lastCoord = `${mergedChain[mergedChain.length - 1][0]},${mergedChain[mergedChain.length - 1][1]}`;
  if (coordCount.get(lastCoord) === 1) {
    mergedChain.reverse(); // Reverse if the starting point is at the "end"
  }

  // Step 3: Build the chain incrementally
  while (sublists.length > 0) {
    const lastCoordInChain = mergedChain[mergedChain.length - 1];

    // Find the next sublist that connects to the current chain
    const nextIndex = sublists.findIndex(sublist =>
      sublist.some(([x, y]) => x === lastCoordInChain[0] && y === lastCoordInChain[1])
    );

    if (nextIndex === -1) {
      throw new Error("Chain is broken; no connecting sublist found.");
    }

    // Extract the next sublist and reverse it if necessary
    const nextSublist = [...sublists[nextIndex]];
    const overlapIndex = nextSublist.findIndex(([x, y]) => x === lastCoordInChain[0] && y === lastCoordInChain[1]);

    if (overlapIndex !== 0) {
      nextSublist.reverse(); // Reverse if the overlap is not at the start
    }

    // Add the non-overlapping part of the sublist to the chain
    mergedChain.push(...nextSublist.slice(1));

    // Remove the processed sublist
    sublists.splice(nextIndex, 1);
  }

  return mergedChain;
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
    console.log('Saving railway route:', routeData.name);
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
    const geometryWKT = `LINESTRING(${sortedCoordinates.map(coord => `${coord[0]} ${coord[1]}`).join(',')})`;
    
    // Get starting and ending part IDs from the path
    const startingPartId = pathResult.partIds.length > 0 ? pathResult.partIds[0] : null;
    const endingPartId = pathResult.partIds.length > 0 ? pathResult.partIds[pathResult.partIds.length - 1] : null;

    let query: string;
    let values: (string | number | null)[];

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
          name,
          description,
          usage_type,
          geometry,
          length_km,
          starting_part_id,
          ending_part_id,
          is_valid
        ) VALUES (
          $1,
          $2,
          $3,
          ST_GeomFromText($4, 4326),
          ST_Length(ST_GeomFromText($4, 4326)::geography) / 1000,
          $5,
          $6,
          TRUE
        )
        RETURNING track_id, length_km
      `;

      values = [
        routeData.name,
        routeData.description || null,
        parseInt(routeData.usage_type),
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