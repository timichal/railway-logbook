import 'dotenv/config';
import { query } from '../lib/db';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Export railway_routes table to JSON file
 */
async function exportRoutes() {
  console.log('Exporting railway_routes table...');

  try {
    const result = await query(`
      SELECT
        track_id,
        name,
        description,
        usage_type,
        ST_AsGeoJSON(geometry) as geometry,
        length_km,
        starting_part_id,
        ending_part_id,
        is_valid,
        error_message,
        created_at,
        updated_at
      FROM railway_routes
      ORDER BY track_id
    `);

    // Parse geometry JSON strings
    const routes = result.rows.map(row => ({
      ...row,
      geometry: JSON.parse(row.geometry)
    }));

    // Create data directory if it doesn't exist
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Write to file with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `railway_routes_${timestamp}.json`;
    const filepath = path.join(dataDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(routes));

    console.log(`✓ Exported ${routes.length} routes to ${filepath}`);
    process.exit(0);
  } catch (error) {
    console.error('Error exporting routes:', error);
    process.exit(1);
  }
}

exportRoutes();
