import type { Client } from 'pg';

/**
 * Validate split parts after importing new OSM data
 * Checks if parent part geometries have changed and invalidates routes using affected split parts
 */
export async function validateSplitPartsAfterImport(client: Client): Promise<void> {
  console.log('Checking for split parts...');

  // Get all split parts with their parent IDs
  const splitsResult = await client.query(`
    SELECT DISTINCT parent_id, COUNT(*) as split_count
    FROM railway_part_splits
    GROUP BY parent_id
  `);

  if (splitsResult.rows.length === 0) {
    console.log('No split parts found - skipping validation');
    return;
  }

  console.log(`Found ${splitsResult.rows.length} parent parts with splits`);

  let invalidatedRouteCount = 0;
  const affectedParentIds: string[] = [];

  // For each parent, check if the geometry has changed
  for (const row of splitsResult.rows) {
    const parentId = row.parent_id;

    // Get the current geometry of the parent part from railway_parts
    const parentResult = await client.query(
      `SELECT ST_AsText(geometry) as geometry_wkt
       FROM railway_parts
       WHERE id = $1`,
      [parentId]
    );

    if (parentResult.rows.length === 0) {
      console.log(`Warning: Parent part ${parentId} not found in railway_parts - may have been removed from OSM`);

      // Mark routes using this parent's splits as invalid
      const invalidateResult = await client.query(
        `UPDATE railway_routes
         SET is_valid = false,
             error_message = 'Parent part removed from OSM data - split parts orphaned'
         WHERE (starting_part_id::TEXT LIKE $1 OR ending_part_id::TEXT LIKE $1)
           AND is_valid = true`,
        [`${parentId}-%`]
      );

      if (invalidateResult.rowCount && invalidateResult.rowCount > 0) {
        invalidatedRouteCount += invalidateResult.rowCount;
        affectedParentIds.push(parentId);
        console.log(`  ⚠ Invalidated ${invalidateResult.rowCount} route(s) using splits of removed parent ${parentId}`);
      }

      continue;
    }

    // Get one of the split parts to compare geometry
    const splitResult = await client.query(
      `SELECT ST_AsText(geometry) as geometry_wkt
       FROM railway_part_splits
       WHERE parent_id = $1
       LIMIT 1`,
      [parentId]
    );

    const currentParentWKT = parentResult.rows[0].geometry_wkt;
    const splitWKT = splitResult.rows[0].geometry_wkt;

    // Simple check: if the parent geometry still contains the split geometry's start/end points
    // For a more thorough check, we would need to reconstruct the original geometry from splits
    // For now, we'll check if the parent part has approximately the same start/end points
    // This is a heuristic - in production, you might want more sophisticated geometry comparison

    // Get start/end points of parent
    const parentPointsResult = await client.query(
      `SELECT
         ST_AsText(ST_StartPoint(geometry)) as start_point,
         ST_AsText(ST_EndPoint(geometry)) as end_point,
         ST_Length(geography) as length
       FROM railway_parts
       WHERE id = $1`,
      [parentId]
    );

    // Get combined length of all splits
    const splitsLengthResult = await client.query(
      `SELECT SUM(ST_Length(geography)) as total_split_length
       FROM railway_part_splits
       WHERE parent_id = $1`,
      [parentId]
    );

    const parentLength = parseFloat(parentPointsResult.rows[0].length);
    const splitsLength = parseFloat(splitsLengthResult.rows[0].total_split_length);

    // If lengths differ significantly (more than 10% AND more than 100m), geometry likely changed
    const lengthDiff = Math.abs(parentLength - splitsLength);
    const lengthDiffPercent = (lengthDiff / parentLength) * 100;

    if (lengthDiff > 100 && lengthDiffPercent > 10) {
      console.log(`  ⚠ Parent part ${parentId} geometry changed (length diff: ${lengthDiff.toFixed(2)}m, ${lengthDiffPercent.toFixed(1)}%)`);

      // Invalidate routes using this parent's split parts
      const invalidateResult = await client.query(
        `UPDATE railway_routes
         SET is_valid = false,
             error_message = $2
         WHERE (starting_part_id::TEXT LIKE $1 OR ending_part_id::TEXT LIKE $1)
           AND is_valid = true`,
        [
          `${parentId}-%`,
          `Split part parent geometry changed during data reload (length diff: ${lengthDiff.toFixed(2)}m). Please review and re-split if needed.`
        ]
      );

      if (invalidateResult.rowCount && invalidateResult.rowCount > 0) {
        invalidatedRouteCount += invalidateResult.rowCount;
        affectedParentIds.push(parentId);
        console.log(`    Invalidated ${invalidateResult.rowCount} route(s) using splits of parent ${parentId}`);
      }
    }
  }

  if (invalidatedRouteCount > 0) {
    console.log('');
    console.log(`⚠ SPLIT VALIDATION SUMMARY:`);
    console.log(`  Total routes invalidated: ${invalidatedRouteCount}`);
    console.log(`  Affected parent parts: ${affectedParentIds.join(', ')}`);
    console.log('  Action required: Review invalid routes in admin interface and re-split parts if needed');
  } else {
    console.log('✓ All split parts validated successfully - no geometry changes detected');
  }
}
