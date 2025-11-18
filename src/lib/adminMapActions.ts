'use server';

import pool from './db';
import { query } from './db';
import { getUser } from './authActions';
import { RailwayPathFinder } from '../scripts/lib/railwayPathFinder';
import type { PathResult, RailwayPart, GeoJSONFeatureCollection, GeoJSONFeature } from './types';

/**
 * Find a path between two railway parts using BFS pathfinding
 */
export async function findRailwayPathDB(startId: string, endId: string): Promise<PathResult | null> {
  // Admin check
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  console.log('Database path finder: Finding path from', startId, 'to', endId);

  const pathFinder = new RailwayPathFinder();
  const result = await pathFinder.findPathWithRetry(pool, startId, endId);

  if (result) {
    console.log('Database path finder: Path found with', result.partIds.length, 'segments and', result.coordinates.length, 'coordinates');
  } else {
    console.log('Database path finder: No path found');
  }

  return result;
}

/**
 * Get railway parts by their IDs (used for route creation)
 * Handles both original parts (numeric IDs) and split parts (compound IDs like "12345-1")
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

    // Separate compound IDs (split parts) from regular IDs
    const compoundIds: string[] = [];
    const regularIds: string[] = [];

    partIds.forEach(id => {
      if (id.includes('-')) {
        compoundIds.push(id);
      } else {
        regularIds.push(id);
      }
    });

    const features: RailwayPart[] = [];

    // Fetch original parts if any regular IDs exist
    if (regularIds.length > 0) {
      const placeholders = regularIds.map((_, index) => `$${index + 1}`).join(',');
      const queryStr = `
        SELECT
          id,
          ST_AsGeoJSON(geometry) as geometry_json
        FROM railway_parts
        WHERE id IN (${placeholders})
          AND geometry IS NOT NULL
      `;

      const result = await client.query(queryStr, regularIds);

      result.rows.forEach(row => {
        const geom = JSON.parse(row.geometry_json);
        if (geom.type === 'LineString') {
          features.push({
            type: 'Feature' as const,
            geometry: geom,
            properties: {
              '@id': parseInt(row.id)
            }
          } as RailwayPart);
        }
      });
    }

    // Fetch split parts if any compound IDs exist
    if (compoundIds.length > 0) {
      const placeholders = compoundIds.map((_, index) => `$${index + 1}`).join(',');
      const queryStr = `
        SELECT
          id,
          ST_AsGeoJSON(geometry) as geometry_json
        FROM railway_part_splits
        WHERE id IN (${placeholders})
          AND geometry IS NOT NULL
      `;

      const result = await client.query(queryStr, compoundIds);

      result.rows.forEach(row => {
        const geom = JSON.parse(row.geometry_json);
        if (geom.type === 'LineString') {
          features.push({
            type: 'Feature' as const,
            geometry: geom,
            properties: {
              '@id': row.id // Keep as string for compound IDs
            }
          } as RailwayPart);
        }
      });
    }

    console.log('Fetched', features.length, 'railway parts from database (original + split)');
    return features;

  } catch (error) {
    console.error('Error fetching railway parts by IDs:', error);
    throw new Error(`Failed to fetch railway parts: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    client.release();
  }
}

/**
 * Get railway parts within map bounds (for admin map display)
 */
export async function getRailwayPartsByBounds(
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  },
  zoom: number
): Promise<GeoJSONFeatureCollection> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  // Get railway parts within bounds (original geometry only)
  // Use different strategies based on zoom level to avoid gaps
  let partsResult;

  if (zoom < 8) {
    // For very low zoom, show only major railway segments (longer ones)
    // Use a higher limit to avoid gaps in main lines
    partsResult = await query(`
      SELECT
        id,
        ST_AsGeoJSON(geometry) as geometry
      FROM railway_parts
      WHERE ST_Intersects(
        geometry,
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
      AND ST_Length(geometry) > 0.001  -- Filter out very short segments
      ORDER BY ST_Length(geometry) DESC
      LIMIT 10000
    `, [bounds.west, bounds.south, bounds.east, bounds.north]);
  } else {
    // For higher zoom levels, show more detail with reasonable limits
    const limit = zoom < 10 ? 20000 : zoom < 12 ? 40000 : 50000;
    partsResult = await query(`
      SELECT
        id,
        ST_AsGeoJSON(geometry) as geometry
      FROM railway_parts
      WHERE ST_Intersects(
        geometry,
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
      ORDER BY ST_Length(geometry) DESC
      LIMIT $5
    `, [bounds.west, bounds.south, bounds.east, bounds.north, limit]);
  }

  const features: GeoJSONFeature[] = [];

  // Add railway parts features
  for (const part of partsResult.rows) {
    features.push({
      type: 'Feature' as const,
      geometry: JSON.parse(part.geometry),
      properties: {
        '@id': part.id,
        zoom_level: zoom
      }
    });
  }

  return {
    type: 'FeatureCollection',
    features
  };
}
