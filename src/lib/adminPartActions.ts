'use server';

import { query } from './db';
import { getUser } from './authActions';
import { findNearestSegment, splitLineStringAtPoint, isValidSplitPoint } from './geometryUtils';
import { isCompoundId, parseCompoundId } from './partUtils';
import { RailwayPart } from './types';

/**
 * Get the effective railway part (either original or split)
 * If the ID is a compound ID, fetch from railway_part_splits
 * Otherwise, fetch from railway_parts
 */
export async function getEffectiveRailwayPart(id: string): Promise<RailwayPart | null> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  if (isCompoundId(id)) {
    // Fetch split part
    const result = await query(
      `SELECT id, ST_AsGeoJSON(geometry) as geometry_json
       FROM railway_part_splits
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      type: 'Feature',
      geometry: JSON.parse(row.geometry_json),
      properties: { '@id': row.id },
    };
  } else {
    // Fetch original part
    const result = await query(
      `SELECT id, ST_AsGeoJSON(geometry) as geometry_json
       FROM railway_parts
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      type: 'Feature',
      geometry: JSON.parse(row.geometry_json),
      properties: { '@id': row.id.toString() },
    };
  }
}

/**
 * Split a railway part at a clicked coordinate
 * Creates two split parts with compound IDs (parentId-1, parentId-2)
 */
export async function splitRailwayPart(
  parentId: string,
  clickedCoordinate: [number, number]
): Promise<{ success: boolean; message: string; splitPartIds?: [string, string] }> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  // Validate that this is not already a split part
  if (isCompoundId(parentId)) {
    return {
      success: false,
      message: 'Cannot split a part that is already split. Please unsplit first.',
    };
  }

  // Check if this part already has splits
  const existingCheck = await query(
    `SELECT COUNT(*) as count FROM railway_part_splits WHERE parent_id = $1`,
    [parentId]
  );

  if (parseInt(existingCheck.rows[0].count) > 0) {
    return {
      success: false,
      message: 'This part is already split. Please unsplit first to re-split.',
    };
  }

  // Fetch the original part geometry
  const partResult = await query(
    `SELECT id, ST_AsGeoJSON(geometry) as geometry_json
     FROM railway_parts
     WHERE id = $1`,
    [parentId]
  );

  if (partResult.rows.length === 0) {
    return {
      success: false,
      message: 'Railway part not found.',
    };
  }

  const geometryJson = JSON.parse(partResult.rows[0].geometry_json);
  if (geometryJson.type !== 'LineString') {
    return {
      success: false,
      message: 'Part geometry is not a LineString.',
    };
  }

  const coordinates = geometryJson.coordinates as [number, number][];

  // Find the nearest segment and calculate split point
  const splitInfo = findNearestSegment(coordinates, clickedCoordinate);
  if (!splitInfo) {
    return {
      success: false,
      message: 'Could not find a valid segment to split.',
    };
  }

  let { segmentIndex, splitPoint } = splitInfo;

  // If split point is too close to existing vertices, snap to the nearest vertex
  if (!isValidSplitPoint(splitPoint, coordinates[segmentIndex], coordinates[segmentIndex + 1])) {
    // Calculate distances to both vertices
    const { calculateDistance } = await import('./map/utils/distance');
    const distToStart = calculateDistance(splitPoint, coordinates[segmentIndex]);
    const distToEnd = calculateDistance(splitPoint, coordinates[segmentIndex + 1]);

    // Snap to the nearest vertex
    splitPoint = distToStart < distToEnd ? coordinates[segmentIndex] : coordinates[segmentIndex + 1];
  }

  // Split the LineString
  const { segment1, segment2 } = splitLineStringAtPoint(coordinates, segmentIndex, splitPoint);

  // Create WKT for both segments
  const wkt1 = `LINESTRING(${segment1.map(c => `${c[0]} ${c[1]}`).join(', ')})`;
  const wkt2 = `LINESTRING(${segment2.map(c => `${c[0]} ${c[1]}`).join(', ')})`;

  // Generate compound IDs
  const splitId1 = `${parentId}-1`;
  const splitId2 = `${parentId}-2`;

  // Insert split parts into database
  try {
    await query(
      `INSERT INTO railway_part_splits (id, parent_id, segment_number, geometry)
       VALUES ($1, $2, 1, ST_GeomFromText($3, 4326)),
              ($4, $5, 2, ST_GeomFromText($6, 4326))`,
      [splitId1, parentId, wkt1, splitId2, parentId, wkt2]
    );

    return {
      success: true,
      message: `Successfully split part ${parentId} into ${splitId1} and ${splitId2}`,
      splitPartIds: [splitId1, splitId2],
    };
  } catch (error) {
    console.error('Error splitting railway part:', error);
    return {
      success: false,
      message: 'Database error while splitting part.',
    };
  }
}

/**
 * Unsplit a railway part (remove split parts)
 * This restores the original part for display and use
 */
export async function unsplitRailwayPart(
  parentId: string
): Promise<{ success: boolean; message: string }> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  // Extract parent ID if a compound ID was provided
  let actualParentId = parentId;
  if (isCompoundId(parentId)) {
    const parsed = parseCompoundId(parentId);
    if (parsed) {
      actualParentId = parsed.parentId;
    }
  }

  // Delete split parts for this parent
  try {
    const result = await query(
      `DELETE FROM railway_part_splits WHERE parent_id = $1`,
      [actualParentId]
    );

    if (result.rowCount === 0) {
      return {
        success: false,
        message: 'No split parts found for this parent ID.',
      };
    }

    return {
      success: true,
      message: `Successfully unsplit part ${actualParentId}. Original part is now displayed.`,
    };
  } catch (error) {
    console.error('Error unsplitting railway part:', error);
    return {
      success: false,
      message: 'Database error while unsplitting part.',
    };
  }
}

/**
 * Check if a part is split (has split parts in the database)
 */
export async function isPartSplit(partId: string): Promise<boolean> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  // If it's already a compound ID, it's definitely a split
  if (isCompoundId(partId)) {
    return true;
  }

  // Check if this parent has splits
  const result = await query(
    `SELECT COUNT(*) as count FROM railway_part_splits WHERE parent_id = $1`,
    [partId]
  );

  return parseInt(result.rows[0].count) > 0;
}
