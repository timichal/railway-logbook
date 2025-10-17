import 'dotenv/config';
import { query } from '../lib/db';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Import railway_routes from JSON file
 */
async function importRoutes() {
  // Get filename from command line arguments
  const filename = process.argv[2];

  if (!filename) {
    console.error('Usage: npm run importRoutes <filename>');
    console.error('Example: npm run importRoutes railway_routes_2025-01-15.json');
    process.exit(1);
  }

  const filepath = path.join(process.cwd(), 'data', filename);

  if (!fs.existsSync(filepath)) {
    console.error(`File not found: ${filepath}`);
    process.exit(1);
  }

  console.log(`Importing routes from ${filepath}...`);

  try {
    const routesData = JSON.parse(fs.readFileSync(filepath, 'utf-8'));

    if (!Array.isArray(routesData)) {
      throw new Error('Invalid data format: expected an array of routes');
    }

    console.log(`Found ${routesData.length} routes in file`);

    // Clear existing routes (optional - comment out if you want to preserve existing data)
    console.log('Clearing existing routes...');
    await query('DELETE FROM railway_routes');

    // Import routes
    let imported = 0;
    for (const route of routesData) {
      try {
        await query(`
          INSERT INTO railway_routes (
            track_id,
            name,
            description,
            usage_type,
            geometry,
            length_km,
            starting_part_id,
            ending_part_id,
            is_valid,
            error_message
          ) VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5), $6, $7, $8, $9, $10)
        `, [
          route.track_id,
          route.name,
          route.description,
          route.usage_type,
          JSON.stringify(route.geometry),
          route.length_km,
          route.starting_part_id,
          route.ending_part_id,
          route.is_valid,
          route.error_message
        ]);
        imported++;
      } catch (error) {
        console.error(`Error importing route ${route.track_id} (${route.name}):`, error);
      }
    }

    console.log(`✓ Imported ${imported}/${routesData.length} routes successfully`);
    process.exit(0);
  } catch (error) {
    console.error('Error importing routes:', error);
    process.exit(1);
  }
}

importRoutes();
