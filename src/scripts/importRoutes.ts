import 'dotenv/config';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { query } from '../lib/db';

/**
 * Import railway_routes, user_journeys, user_logged_parts, and admin_notes from SQL dump
 */
async function importRoutes() {
  // Get filename from command line arguments
  const filename = process.argv[2];

  if (!filename) {
    console.error('Usage: npm run importRouteData <filename>');
    console.error('Example: npm run importRouteData ./data/railway_data_2025-01-15.sql');
    console.error('\nImports railway_routes, user_journeys, user_logged_parts (user_id=1), and admin_notes from SQL dump');
    process.exit(1);
  }

  if (!fs.existsSync(filename)) {
    console.error(`File not found: ${filename}`);
    process.exit(1);
  }

  // Verify it's a SQL file
  if (!filename.endsWith('.sql')) {
    console.error('Error: File must be a .sql file');
    process.exit(1);
  }

  console.log(`Importing railway data from ${filename}...`);
  console.log('This will import: railway_routes, user_journeys, user_logged_parts (user_id=1), and admin_notes\n');

  try {
    // Get database credentials from environment
    const dbName = process.env.POSTGRES_DB || '';
    const dbUser = process.env.DB_USER || '';

    console.log('Copying SQL file to container...');

    const containerName = 'db';
    const containerPath = '/tmp/import.sql';

    // Copy file to container
    try {
      execSync(`docker cp "${filename}" ${containerName}:${containerPath}`, {
        encoding: 'utf-8'
      });
      console.log('✓ File copied to container');
    } catch (error) {
      console.error('Error copying file to container:', error);
      throw error;
    }

    console.log('Executing SQL dump...');

    // Execute the SQL file inside the container
    const psqlCmd = `docker exec ${containerName} psql -U ${dbUser} -d ${dbName} -f ${containerPath}`;

    try {
      const output = execSync(psqlCmd, {
        encoding: 'utf-8',
        stdio: 'pipe'
      });

      // Count successful operations from output
      const deleteMatches = output.match(/DELETE \d+/g) || [];
      const insertMatches = output.match(/INSERT 0 1/g) || [];

      console.log(`✓ SQL dump executed successfully`);
      if (deleteMatches.length > 0) {
        console.log(`✓ Deleted entries: ${deleteMatches.join(', ')}`);
      }
      if (insertMatches.length > 0) {
        console.log(`✓ Inserted rows: ${insertMatches.length}`);
      }

      // Clean up temp file in container
      try {
        execSync(`docker exec ${containerName} rm ${containerPath}`, {
          encoding: 'utf-8'
        });
      } catch {
        // Ignore cleanup errors
      }

      // Verify what was imported
      console.log('\nVerifying imported data...');

      try {
        const routesCount = await query('SELECT COUNT(*) FROM railway_routes');
        console.log(`✓ Railway routes: ${routesCount.rows[0].count}`);

        const journeysCount = await query('SELECT COUNT(*) FROM user_journeys WHERE user_id = 1');
        console.log(`✓ User journeys (user_id=1): ${journeysCount.rows[0].count}`);

        const loggedPartsCount = await query('SELECT COUNT(*) FROM user_logged_parts WHERE user_id = 1');
        console.log(`✓ User logged parts (user_id=1): ${loggedPartsCount.rows[0].count}`);

        const notesCount = await query('SELECT COUNT(*) FROM admin_notes');
        console.log(`✓ Admin notes: ${notesCount.rows[0].count}`);
      } catch (verifyError) {
        console.warn('Warning: Could not verify imported data counts');
      }

      console.log(`\n✓ Import completed successfully`);

      process.exit(0);
    } catch (error) {
      console.error('Error executing psql command:');
      if (error && typeof error === 'object' && 'stderr' in error) {
        console.error(String(error.stderr));
      }
      if (error && typeof error === 'object' && 'stdout' in error) {
        console.log('Output:', String(error.stdout));
      }
      throw error;
    }
  } catch (error) {
    console.error('Error importing data:', error);
    process.exit(1);
  }
}

importRoutes();
