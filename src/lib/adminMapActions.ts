'use server';

import pool from './db';
import { query } from './db';
import { getUser } from './authActions';
import { RailwayPathFinder } from '../scripts/lib/railwayPathFinder';
import type { PathResult, RailwayPart, GeoJSONFeatureCollection, GeoJSONFeature, RailwayPartSplit } from './types';

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
 * Helper function to extract segment geometry from a full part geometry
 * @param coordinates - Full part coordinates
 * @param split - Split metadata
 * @param segmentIndex - 0 for first segment, 1 for second segment
 */
function extractSegmentGeometry(
  coordinates: [number, number][],
  split: RailwayPartSplit,
  segmentIndex: number
): [number, number][] {
  const splitFraction = split.split_fraction;
  const totalPoints = coordinates.length - 1;
  const splitIndex = Math.floor(splitFraction * totalPoints);

  const splitCoordinate = split.split_coordinate;

  if (segmentIndex === 0) {
    // First segment: from start to split point
    const segCoords = coordinates.slice(0, splitIndex + 1);
    segCoords.push(splitCoordinate);
    return segCoords;
  } else {
    // Second segment: from split point to end
    return [splitCoordinate, ...coordinates.slice(splitIndex + 1)];
  }
}

/**
 * Parse segment ID to extract original part ID and segment index
 * Returns { originalId, segmentIndex } or null if not a segment ID
 */
function parseSegmentId(partId: string): { originalId: string; segmentIndex: number } | null {
  const match = partId.match(/^(\d+)_seg([01])$/);
  if (match) {
    return {
      originalId: match[1],
      segmentIndex: parseInt(match[2])
    };
  }
  return null;
}

/**
 * Get railway parts by their IDs (split-aware, used for route creation)
 * Handles both regular part IDs and segment IDs (e.g., "12345_seg0")
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

    // Separate regular part IDs from segment IDs
    const segmentRequests: Array<{ partId: string; originalId: string; segmentIndex: number }> = [];
    const regularPartIds: string[] = [];

    for (const partId of partIds) {
      const parsed = parseSegmentId(partId);
      if (parsed) {
        segmentRequests.push({ partId, ...parsed });
      } else {
        regularPartIds.push(partId);
      }
    }

    // Get unique original part IDs to fetch
    const uniqueOriginalIds = new Set<string>();
    regularPartIds.forEach(id => uniqueOriginalIds.add(id));
    segmentRequests.forEach(req => uniqueOriginalIds.add(req.originalId));

    const idsToFetch = Array.from(uniqueOriginalIds);

    if (idsToFetch.length === 0) return [];

    // Fetch all required parts from database
    const placeholders = idsToFetch.map((_, index) => `$${index + 1}`).join(',');

    const queryStr = `
      SELECT
        id,
        ST_AsGeoJSON(geometry) as geometry_json
      FROM railway_parts
      WHERE id IN (${placeholders})
        AND geometry IS NOT NULL
    `;

    const result = await client.query(queryStr, idsToFetch);

    // Build a map of part ID to geometry
    const partGeometries = new Map<string, [number, number][]>();
    for (const row of result.rows) {
      const geom = JSON.parse(row.geometry_json);
      if (geom.type === 'LineString') {
        partGeometries.set(row.id.toString(), geom.coordinates);
      }
    }

    // Fetch split information for parts that might be split
    const splitsQueryStr = `
      SELECT
        part_id,
        ST_AsGeoJSON(split_coordinate) as split_coordinate_json,
        split_fraction
      FROM railway_part_splits
      WHERE part_id IN (${placeholders})
    `;

    const splitsResult = await client.query(splitsQueryStr, idsToFetch);

    // Build a map of part ID to split info
    const splits = new Map<string, RailwayPartSplit>();
    for (const row of splitsResult.rows) {
      const splitCoordJson = JSON.parse(row.split_coordinate_json);
      splits.set(row.part_id.toString(), {
        id: 0, // Not needed for this use case
        part_id: row.part_id,
        split_coordinate: splitCoordJson.coordinates,
        split_fraction: parseFloat(row.split_fraction),
        created_at: '',
        created_by: null
      });
    }

    // Build result array in the same order as input partIds
    const features: RailwayPart[] = [];

    for (const partId of partIds) {
      const parsed = parseSegmentId(partId);

      if (parsed) {
        // This is a segment ID - extract the appropriate segment
        const coordinates = partGeometries.get(parsed.originalId);
        const split = splits.get(parsed.originalId);

        if (coordinates && split) {
          const segmentCoords = extractSegmentGeometry(coordinates, split, parsed.segmentIndex);
          features.push({
            type: 'Feature' as const,
            geometry: {
              type: 'LineString',
              coordinates: segmentCoords
            },
            properties: {
              '@id': partId // Use segment ID as identifier
            }
          } as RailwayPart);
        } else {
          console.warn(`Segment ${partId} requested but split not found or part missing`);
        }
      } else {
        // Regular part ID
        const coordinates = partGeometries.get(partId);

        if (coordinates) {
          features.push({
            type: 'Feature' as const,
            geometry: {
              type: 'LineString',
              coordinates
            },
            properties: {
              '@id': parseInt(partId)
            }
          } as RailwayPart);
        }
      }
    }

    console.log('Fetched', features.length, 'railway parts/segments from database');
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
