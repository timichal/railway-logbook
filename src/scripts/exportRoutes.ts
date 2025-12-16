import 'dotenv/config';
import { query } from '../lib/db';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Export railway_routes, user_trips (user_id=1), and admin_notes to SQL dump
 */
async function exportRoutes() {
  console.log('Exporting railway_routes, user_trips, and admin_notes...');

  // Create data directory if it doesn't exist
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Declare temp file path in outer scope for cleanup in error handler
  const tempFilepath = path.join(dataDir, 'temp_routes_dump.sql');

  try {
    // Generate filename with timestamp
    const now = new Date();
    const timestamp = now.toISOString().replace(/:/g, '-').split('.')[0];
    const filename = `railway_data_${timestamp}.sql`;
    const filepath = path.join(dataDir, filename);

    // Get database credentials from environment
    const dbName = process.env.POSTGRES_DB || '';
    const dbUser = process.env.DB_USER || '';

    console.log('Exporting railway_routes table...');

    // Use docker exec to run pg_dump inside the container
    // Redirect output directly to a temp file to avoid ENOBUFS error
    const containerName = 'db';
    const pgDumpCmd = `docker exec ${containerName} pg_dump -U ${dbUser} -d ${dbName} --table=railway_routes --data-only --column-inserts > "${tempFilepath}"`;

    try {
      execSync(pgDumpCmd, {
        stdio: 'inherit' // Don't capture output, redirect directly to file
      });
    } catch (error) {
      console.error('Error running pg_dump:', error);
      throw error;
    }

    // Read the dump from the temp file
    const sqlDump = fs.readFileSync(tempFilepath, 'utf-8');

    // Get user_trips for user_id=1
    // Get user_trips for user_id=1
    console.log('Exporting user_trips for user_id=1...');
    const userDataResult = await query(`
      SELECT
        user_id,
        track_id,
        date,
        note,
        partial
      FROM user_trips
      WHERE user_id = 1
      ORDER BY track_id
    `);

    // Generate SQL INSERT statements for user_trips
    let userDataSQL = '\n-- User railway data for user_id=1\n';
    if (userDataResult.rows.length > 0) {
      userDataSQL += 'DELETE FROM public.user_trips WHERE user_id = 1;\n\n';
      for (const row of userDataResult.rows) {
        const dateValue = row.date ? `'${row.date.toISOString().split('T')[0]}'` : 'NULL';
        const noteValue = row.note ? `'${row.note.replace(/'/g, "''")}'` : 'NULL';
        const partialValue = row.partial ? 'true' : 'false';

        userDataSQL += `INSERT INTO public.user_trips (user_id, track_id, date, note, partial) VALUES (${row.user_id}, ${row.track_id}, ${dateValue}, ${noteValue}, ${partialValue});\n`;
      }
    } else {
      userDataSQL += '-- No user data found for user_id=1\n';
    }

    // Get admin_notes using pg_dump (same as railway_routes)
    console.log('Exporting admin_notes...');
    const tempNotesFilepath = path.join(dataDir, 'temp_notes_dump.sql');
    const pgDumpNotesCmd = `docker exec ${containerName} pg_dump -U ${dbUser} -d ${dbName} --table=admin_notes --data-only --column-inserts > "${tempNotesFilepath}"`;

    let adminNotesSQL = '\n-- Admin notes\n';
    try {
      execSync(pgDumpNotesCmd, {
        stdio: 'inherit'
      });

      // Read the dump
      const notesDump = fs.readFileSync(tempNotesFilepath, 'utf-8');

      if (notesDump.includes('INSERT INTO')) {
        adminNotesSQL += 'DELETE FROM public.admin_notes;\n\n';
        adminNotesSQL += notesDump;
        adminNotesSQL += '\nSELECT setval(\'admin_notes_id_seq\', (SELECT MAX(id) FROM admin_notes));\n';
      } else {
        adminNotesSQL += '-- No admin notes found\n';
      }

      // Clean up temp file
      if (fs.existsSync(tempNotesFilepath)) {
        fs.unlinkSync(tempNotesFilepath);
      }
    } catch (error) {
      console.error('Error exporting admin_notes:', error);
      adminNotesSQL += '-- Error exporting admin notes\n';

      // Clean up temp file
      if (fs.existsSync(tempNotesFilepath)) {
        fs.unlinkSync(tempNotesFilepath);
      }
    }

    // Get count for reporting
    const adminNotesResult = await query('SELECT COUNT(*) FROM admin_notes');
    const notesCount = adminNotesResult.rows[0].count;

    // Combine the dumps
    const fullDump = `-- Railway Data Export (${timestamp})
-- This file contains:
--   1. railway_routes table (full export)
--   2. user_trips for user_id=1
--   3. admin_notes (admin-only annotations)

-- Clear existing data
DELETE FROM public.railway_routes;

-- Disable triggers during import (avoids ST_Transform search_path issues)
SET session_replication_role = replica;

${sqlDump}

${userDataSQL}

${adminNotesSQL}

-- Re-enable triggers
SET session_replication_role = DEFAULT;
`;

    // Write to file
    fs.writeFileSync(filepath, fullDump);

    // Clean up temp file
    if (fs.existsSync(tempFilepath)) {
      fs.unlinkSync(tempFilepath);
    }

    console.log(`✓ Exported railway_routes (${sqlDump.split('\n').filter(l => l.startsWith('INSERT')).length} routes)`);
    console.log(`✓ Exported user_trips (${userDataResult.rows.length} records)`);
    console.log(`✓ Exported admin_notes (${notesCount} notes)`);
    console.log(`✓ Saved to ${filepath}`);
    process.exit(0);
  } catch (error) {
    console.error('Error exporting data:', error);

    // Clean up temp file if it exists
    if (fs.existsSync(tempFilepath)) {
      fs.unlinkSync(tempFilepath);
    }

    process.exit(1);
  }
}

exportRoutes();
