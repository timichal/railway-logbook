#!/usr/bin/env tsx
/**
 * Classify railway routes by line_class based on their constituent railway_parts
 *
 * For each route, finds overlapping railway_parts using spatial intersection,
 * then computes a length-weighted majority classification:
 *   - If majority of overlap length has highspeed=true parts → 'highspeed'
 *   - Else if majority has usage='main' parts → 'main'
 *   - Otherwise → 'branch'
 *
 * Prerequisites: railway_parts must have usage/highspeed data populated
 * (run importMapData first to load parts with OSM tags)
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import { getDbConfig } from '../lib/dbConfig';

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function classifyRoutes() {
  const client = await pool.connect();

  try {
    console.log('Classifying railway routes by line_class...');
    console.log('=====================================\n');

    // Check if railway_parts have usage data
    const tagCheck = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(usage) as with_usage,
        COUNT(CASE WHEN highspeed = TRUE THEN 1 END) as with_highspeed
      FROM railway_parts
    `);

    const { total, with_usage, with_highspeed } = tagCheck.rows[0];
    console.log(`Railway parts: ${total} total, ${with_usage} with usage tag, ${with_highspeed} with highspeed=true`);

    if (parseInt(with_usage) === 0) {
      console.log('\nWARNING: No railway_parts have usage data. Run importMapData first to load parts with OSM tags.');
      console.log('Skipping classification.\n');
      return;
    }

    // Step 1: Get all route IDs to process
    const routeCountResult = await client.query(`
      SELECT COUNT(*) as count FROM railway_routes WHERE geometry IS NOT NULL
    `);
    const totalRoutes = parseInt(routeCountResult.rows[0].count);
    console.log(`Found ${totalRoutes} routes to classify.\n`);

    // Step 2: Classify routes one by one with progress
    const counts = { highspeed: 0, main: 0, branch: 0, unchanged: 0 };
    let processed = 0;

    const routes = await client.query(`
      SELECT track_id, from_station, to_station FROM railway_routes WHERE geometry IS NOT NULL ORDER BY track_id
    `);

    for (const route of routes.rows) {
      processed++;

      const classResult = await client.query(`
        WITH route_parts AS (
          SELECT
            rp.usage,
            rp.highspeed,
            ST_Length(
              ST_Intersection(rr.geometry::geography, rp.geometry::geography)
            ) as overlap_length_m
          FROM railway_routes rr
          JOIN railway_parts rp ON ST_Intersects(rr.geometry, rp.geometry)
          WHERE rr.track_id = $1
            AND rp.geometry IS NOT NULL
        )
        SELECT
          CASE
            WHEN SUM(CASE WHEN highspeed = TRUE THEN overlap_length_m ELSE 0 END) >
                 SUM(overlap_length_m) * 0.5
            THEN 'highspeed'
            WHEN SUM(CASE WHEN usage = 'main' THEN overlap_length_m ELSE 0 END) >
                 SUM(overlap_length_m) * 0.5
            THEN 'main'
            ELSE 'branch'
          END as new_line_class
        FROM route_parts
        HAVING SUM(overlap_length_m) > 0;
      `, [route.track_id]);

      if (classResult.rows.length > 0) {
        const newClass = classResult.rows[0].new_line_class;

        const updateResult = await client.query(`
          UPDATE railway_routes
          SET line_class = $1, updated_at = CURRENT_TIMESTAMP
          WHERE track_id = $2 AND (line_class IS NULL OR line_class != $1)
          RETURNING track_id;
        `, [newClass, route.track_id]);

        if (updateResult.rowCount && updateResult.rowCount > 0) {
          counts[newClass as keyof typeof counts]++;
        } else {
          counts.unchanged++;
        }
      } else {
        counts.unchanged++;
      }

      // Progress every 10 routes or on last one
      if (processed % 10 === 0 || processed === totalRoutes) {
        process.stdout.write(`\r  ${processed}/${totalRoutes} routes processed...`);
      }
    }

    console.log(`\n\nClassification results:\n`);
    console.log(`  High-speed: ${counts.highspeed}`);
    console.log(`  Main: ${counts.main}`);
    console.log(`  Branch: ${counts.branch}`);
    console.log(`  Unchanged: ${counts.unchanged}`);

    // Show final distribution
    const totalStats = await client.query(`
      SELECT line_class, COUNT(*) as count
      FROM railway_routes
      GROUP BY line_class
      ORDER BY line_class;
    `);

    console.log('\nFinal route distribution:');
    for (const row of totalStats.rows) {
      console.log(`  ${row.line_class}: ${row.count}`);
    }

    console.log('\n=====================================');
    console.log('Classification complete!');
    console.log('=====================================\n');

  } catch (error) {
    console.error('Error classifying routes:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
classifyRoutes().catch((error) => {
  console.error('Script error:', error);
  process.exit(1);
});
