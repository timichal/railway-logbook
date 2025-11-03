import 'dotenv/config';
import * as fs from 'fs';
import { execSync } from 'child_process';

/**
 * Import railway_routes and user_trips from SQL dump
 */
async function importRoutes() {
  // Get filename from command line arguments
  const filename = process.argv[2];

  if (!filename) {
    console.error('Usage: npm run importRoutes <filename>');
    console.error('Example: npm run importRoutes railway_data_2025-01-15.sql');
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

      console.log(`✓ Import completed`);

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
