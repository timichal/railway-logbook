'use server';

import pool from './db';
import { query } from './db';
import { getUser } from './authActions';
import { RailwayPathFinder } from '../scripts/lib/railwayPathFinder';
import type { PathResult, RailwayPart, GeoJSONFeatureCollection, GeoJSONFeature } from './types';

/**
 * Find a path between two coordinates using BFS pathfinding
 * This is the new coordinate-based pathfinding method
 */
export async function findRailwayPathFromCoordinates(
  startCoordinate: [number, number],
  endCoordinate: [number, number]
): Promise<PathResult | null> {
  // Admin check
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  console.log('Coordinate-based path finder: Finding path from', startCoordinate, 'to', endCoordinate);

  const pathFinder = new RailwayPathFinder();
  const result = await pathFinder.findPathFromCoordinates(pool, startCoordinate, endCoordinate);

  if (result) {
    console.log('Coordinate-based path finder: Path found with', result.partIds.length, 'segments and', result.coordinates.length, 'coordinates');
  } else {
    console.log('Coordinate-based path finder: No path found');
  }

  return result;
}

/**
 * Get railway parts by their IDs (used for route creation)
 */
export async function getRailwayPartsByIds(partIds: string[]): Promise<RailwayPart[]> {
  // Admin check
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  if (partIds.length === 0) return [];

  const client = await pool.connect();

  try {
    console.log('Fetching railway parts for IDs:', partIds);

    const placeholders = partIds.map((_, index) => `$${index + 1}`).join(',');
    const queryStr = `
      SELECT
        id,
        ST_AsGeoJSON(geometry) as geometry_json
      FROM railway_parts
      WHERE id IN (${placeholders})
        AND geometry IS NOT NULL
    `;

    const result = await client.query(queryStr, partIds);

    const features: RailwayPart[] = result.rows.map(row => {
      const geom = JSON.parse(row.geometry_json);
      return {
        type: 'Feature' as const,
        geometry: geom,
        properties: {
          '@id': parseInt(row.id)
        }
      } as RailwayPart;
    });

    console.log('Fetched', features.length, 'railway parts from database');
    return features;

  } catch (error) {
    console.error('Error fetching railway parts by IDs:', error);
    throw new Error(`Failed to fetch railway parts: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    client.release();
  }
}
