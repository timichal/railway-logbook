'use server';

/**
 * Server actions for managing railway part splits
 * These actions allow admins to manually split railway parts for better alignment with stations
 */

import pool from './db';
import type { RailwayPartSplit } from './types';

/**
 * Split a railway part at a clicked point
 * Calculates the exact split coordinate and fraction using PostGIS
 */
export async function splitRailwayPart(
  partId: string | number,
  clickCoordinate: [number, number],
  userId: number
): Promise<{ success: boolean; split?: RailwayPartSplit; error?: string }> {
  const client = await pool.connect();

  try {
    // Security check: Only admin (user_id = 1) can split parts
    if (userId !== 1) {
      return { success: false, error: 'Unauthorized: Only admin can split railway parts' };
    }

    // Verify the part exists
    const partCheck = await client.query(
      'SELECT id, ST_AsGeoJSON(geometry) as geometry_json FROM railway_parts WHERE id = $1',
      [partId]
    );

    if (partCheck.rows.length === 0) {
      return { success: false, error: `Railway part ${partId} not found` };
    }

    // Calculate the split point using PostGIS
    // ST_LineLocatePoint returns a fraction (0.0 to 1.0) along the line
    // ST_ClosestPoint finds the nearest point on the line to the clicked coordinate
    const splitCalc = await client.query(`
      SELECT
        ST_AsGeoJSON(ST_ClosestPoint(
          geometry,
          ST_SetSRID(ST_MakePoint($2, $3), 4326)
        )) as split_point,
        ST_LineLocatePoint(
          geometry,
          ST_SetSRID(ST_MakePoint($2, $3), 4326)
        ) as split_fraction
      FROM railway_parts
      WHERE id = $1
    `, [partId, clickCoordinate[0], clickCoordinate[1]]);

    const splitFraction = parseFloat(splitCalc.rows[0].split_fraction);
    const splitPoint = JSON.parse(splitCalc.rows[0].split_point);

    // Validate split fraction (must not be at endpoints)
    if (splitFraction <= 0.01 || splitFraction >= 0.99) {
      return {
        success: false,
        error: 'Split point is too close to an endpoint. Please click somewhere along the middle of the part.'
      };
    }

    // Insert or update the split (UPSERT to handle updating existing splits)
    const result = await client.query(`
      INSERT INTO railway_part_splits (part_id, split_coordinate, split_fraction, created_by)
      VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5)
      ON CONFLICT (part_id)
      DO UPDATE SET
        split_coordinate = ST_SetSRID(ST_MakePoint($2, $3), 4326),
        split_fraction = $4,
        created_by = $5,
        created_at = CURRENT_TIMESTAMP
      RETURNING id, part_id, ST_AsGeoJSON(split_coordinate) as split_coordinate_json, split_fraction, created_at, created_by
    `, [partId, splitPoint.coordinates[0], splitPoint.coordinates[1], splitFraction, userId]);

    const row = result.rows[0];
    const splitCoordJson = JSON.parse(row.split_coordinate_json);

    const split: RailwayPartSplit = {
      id: row.id,
      part_id: row.part_id,
      split_coordinate: splitCoordJson.coordinates,
      split_fraction: parseFloat(row.split_fraction),
      created_at: row.created_at,
      created_by: row.created_by
    };

    return { success: true, split };

  } catch (error) {
    console.error('Error splitting railway part:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  } finally {
    client.release();
  }
}

/**
 * Remove a split from a railway part
 */
export async function removeSplit(
  partId: string | number,
  userId: number
): Promise<{ success: boolean; error?: string }> {
  const client = await pool.connect();

  try {
    // Security check: Only admin (user_id = 1) can remove splits
    if (userId !== 1) {
      return { success: false, error: 'Unauthorized: Only admin can remove railway part splits' };
    }

    const result = await client.query(
      'DELETE FROM railway_part_splits WHERE part_id = $1 RETURNING id',
      [partId]
    );

    if (result.rows.length === 0) {
      return { success: false, error: `No split found for part ${partId}` };
    }

    return { success: true };

  } catch (error) {
    console.error('Error removing split:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  } finally {
    client.release();
  }
}

/**
 * Get split metadata for a specific part
 */
export async function getSplitForPart(
  partId: string | number
): Promise<RailwayPartSplit | null> {
  const client = await pool.connect();

  try {
    const result = await client.query(`
      SELECT
        id,
        part_id,
        ST_AsGeoJSON(split_coordinate) as split_coordinate_json,
        split_fraction,
        created_at,
        created_by
      FROM railway_part_splits
      WHERE part_id = $1
    `, [partId]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const splitCoordJson = JSON.parse(row.split_coordinate_json);

    return {
      id: row.id,
      part_id: row.part_id,
      split_coordinate: splitCoordJson.coordinates,
      split_fraction: parseFloat(row.split_fraction),
      created_at: row.created_at,
      created_by: row.created_by
    };

  } catch (error) {
    console.error('Error getting split for part:', error);
    return null;
  } finally {
    client.release();
  }
}

/**
 * Get all splits (useful for pathfinding and route creation)
 */
export async function getAllSplits(): Promise<Map<string, RailwayPartSplit>> {
  const client = await pool.connect();

  try {
    const result = await client.query(`
      SELECT
        id,
        part_id,
        ST_AsGeoJSON(split_coordinate) as split_coordinate_json,
        split_fraction,
        created_at,
        created_by
      FROM railway_part_splits
    `);

    const splitsMap = new Map<string, RailwayPartSplit>();

    for (const row of result.rows) {
      const splitCoordJson = JSON.parse(row.split_coordinate_json);
      splitsMap.set(row.part_id.toString(), {
        id: row.id,
        part_id: row.part_id,
        split_coordinate: splitCoordJson.coordinates,
        split_fraction: parseFloat(row.split_fraction),
        created_at: row.created_at,
        created_by: row.created_by
      });
    }

    return splitsMap;

  } catch (error) {
    console.error('Error getting all splits:', error);
    return new Map();
  } finally {
    client.release();
  }
}

/**
 * Get list of part IDs that have splits
 */
export async function getSplitPartIds(): Promise<string[]> {
  const client = await pool.connect();

  try {
    const result = await client.query(`
      SELECT part_id FROM railway_part_splits
    `);

    return result.rows.map(row => row.part_id.toString());
  } catch (error) {
    console.error('Error getting split part IDs:', error);
    return [];
  } finally {
    client.release();
  }
}

/**
 * Get all split segments as GeoJSON features for map display
 */
export async function getSplitSegmentsGeoJSON(): Promise<{
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: {
      type: 'LineString';
      coordinates: [number, number][];
    };
    properties: {
      part_id: string;
      segment_id: string; // e.g., "12345_seg0" or "12345_seg1"
      segment_index: number; // 0 or 1
    };
  }>;
}> {
  const client = await pool.connect();

  try {
    // Fetch all splits and their parent parts
    const result = await client.query(`
      SELECT
        s.part_id,
        s.split_fraction,
        ST_AsGeoJSON(s.split_coordinate) as split_coordinate_json,
        ST_AsGeoJSON(rp.geometry) as part_geometry_json
      FROM railway_part_splits s
      JOIN railway_parts rp ON rp.id = s.part_id
    `);

    const features = [];

    for (const row of result.rows) {
      const partId = row.part_id.toString();
      const splitFraction = parseFloat(row.split_fraction);
      const splitCoordJson = JSON.parse(row.split_coordinate_json);
      const partGeomJson = JSON.parse(row.part_geometry_json);

      if (partGeomJson.type === 'LineString') {
        const coordinates = partGeomJson.coordinates as [number, number][];
        const splitCoordinate = splitCoordJson.coordinates as [number, number];

        // Calculate split index
        const totalPoints = coordinates.length - 1;
        const splitIndex = Math.floor(splitFraction * totalPoints);

        // Segment 0: from start to split point
        const seg0Coords = coordinates.slice(0, splitIndex + 1);
        seg0Coords.push(splitCoordinate);

        features.push({
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: seg0Coords
          },
          properties: {
            part_id: partId,
            segment_id: `${partId}_seg0`,
            segment_index: 0
          }
        });

        // Segment 1: from split point to end
        const seg1Coords = [splitCoordinate, ...coordinates.slice(splitIndex + 1)];

        features.push({
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: seg1Coords
          },
          properties: {
            part_id: partId,
            segment_id: `${partId}_seg1`,
            segment_index: 1
          }
        });
      }
    }

    return {
      type: 'FeatureCollection',
      features
    };

  } catch (error) {
    console.error('Error getting split segments GeoJSON:', error);
    return {
      type: 'FeatureCollection',
      features: []
    };
  } finally {
    client.release();
  }
}

/**
 * Find routes that use a specific part as starting or ending part
 */
export async function getAffectedRoutesBySplit(
  partId: string | number
): Promise<Array<{ track_id: number; from_station: string; to_station: string; position: 'start' | 'end' | 'both' }>> {
  const client = await pool.connect();

  try {
    const result = await client.query(`
      SELECT
        track_id,
        from_station,
        to_station,
        starting_part_id,
        ending_part_id
      FROM railway_routes
      WHERE starting_part_id = $1 OR ending_part_id = $1
    `, [partId]);

    return result.rows.map(row => {
      let position: 'start' | 'end' | 'both' = 'start';
      if (row.starting_part_id === partId.toString() && row.ending_part_id === partId.toString()) {
        position = 'both';
      } else if (row.ending_part_id === partId.toString()) {
        position = 'end';
      }

      return {
        track_id: row.track_id,
        from_station: row.from_station,
        to_station: row.to_station,
        position
      };
    });

  } catch (error) {
    console.error('Error getting affected routes:', error);
    return [];
  } finally {
    client.release();
  }
}
