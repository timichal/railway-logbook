import 'dotenv/config';
import { query } from '../lib/db';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Export railway_routes and user_railway_data (user_id=1) to SQL dump
 */
async function exportRoutes() {
  console.log('Exporting railway_routes and user_railway_data...');

  try {
    // Create data directory if it doesn't exist
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `railway_data_${timestamp}.sql`;
    const filepath = path.join(dataDir, filename);

    // Get database credentials from environment
    const dbName = process.env.POSTGRES_DB || 'railmap';
    const dbUser = process.env.DB_USER || 'postgres';

    console.log('Exporting railway_routes table...');

    // Use docker exec to run pg_dump inside the container
    const containerName = 'osm-railways-db';
    const pgDumpCmd = `docker exec ${containerName} pg_dump -U ${dbUser} -d ${dbName} --table=railway_routes --data-only --column-inserts`;

    let sqlDump = '';
    try {
      sqlDump = execSync(pgDumpCmd, { encoding: 'utf-8' });
    } catch (error) {
      console.error('Error running pg_dump:', error);
      throw error;
    }

    // Get user_railway_data for user_id=1
    console.log('Exporting user_railway_data for user_id=1...');
    const userDataResult = await query(`
      SELECT
        user_id,
        track_id,
        date,
        note,
        partial
      FROM user_railway_data
      WHERE user_id = 1
      ORDER BY track_id
    `);

    // Generate SQL INSERT statements for user_railway_data
    let userDataSQL = '\n-- User railway data for user_id=1\n';
    if (userDataResult.rows.length > 0) {
      userDataSQL += 'DELETE FROM public.user_railway_data WHERE user_id = 1;\n\n';
      for (const row of userDataResult.rows) {
        const dateValue = row.date ? `'${row.date.toISOString().split('T')[0]}'` : 'NULL';
        const noteValue = row.note ? `'${row.note.replace(/'/g, "''")}'` : 'NULL';
        const partialValue = row.partial ? 'true' : 'false';

        userDataSQL += `INSERT INTO public.user_railway_data (user_id, track_id, date, note, partial) VALUES (${row.user_id}, ${row.track_id}, ${dateValue}, ${noteValue}, ${partialValue});\n`;
      }
    } else {
      userDataSQL += '-- No user data found for user_id=1\n';
    }

    // Combine the dumps
    const fullDump = `-- Railway Data Export (${timestamp})
-- This file contains:
--   1. railway_routes table (full export)
--   2. user_railway_data for user_id=1

-- Clear existing railway_routes
DELETE FROM public.railway_routes;

-- Disable triggers during import (avoids ST_Transform search_path issues)
SET session_replication_role = replica;

${sqlDump}

${userDataSQL}

-- Re-enable triggers
SET session_replication_role = DEFAULT;
`;

    // Write to file
    fs.writeFileSync(filepath, fullDump);

    console.log(`✓ Exported railway_routes (${sqlDump.split('\n').filter(l => l.startsWith('INSERT')).length} routes)`);
    console.log(`✓ Exported user_railway_data (${userDataResult.rows.length} records)`);
    console.log(`✓ Saved to ${filepath}`);
    process.exit(0);
  } catch (error) {
    console.error('Error exporting data:', error);
    process.exit(1);
  }
}

exportRoutes();
