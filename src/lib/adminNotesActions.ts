'use server';

import pool from './db';
import { getUser } from './authActions';
import type { AdminNote } from './types';
import type { NoteType } from './constants';

type AdminNoteRow = {
  id: number;
  coordinate: { coordinates: [number, number] };
  text: string;
  note_type: NoteType | null;
  created_at: Date;
  updated_at: Date;
};

function rowToNote(row: AdminNoteRow): AdminNote {
  return {
    id: row.id,
    coordinate: row.coordinate.coordinates,
    text: row.text,
    note_type: row.note_type,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Get all admin notes
 * Admin-only (user_id=1)
 */
export async function getAllAdminNotes(): Promise<AdminNote[]> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await pool.query<AdminNoteRow>(`
    SELECT
      id,
      ST_AsGeoJSON(coordinate)::json as coordinate,
      text,
      note_type,
      created_at,
      updated_at
    FROM admin_notes
    ORDER BY updated_at DESC
  `);

  return result.rows.map(rowToNote);
}

/**
 * Get a single admin note by ID
 * Admin-only (user_id=1)
 */
export async function getAdminNote(id: number): Promise<AdminNote | null> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await pool.query<AdminNoteRow>(`
    SELECT
      id,
      ST_AsGeoJSON(coordinate)::json as coordinate,
      text,
      note_type,
      created_at,
      updated_at
    FROM admin_notes
    WHERE id = $1
  `, [id]);

  if (result.rows.length === 0) {
    return null;
  }

  return rowToNote(result.rows[0]);
}

/**
 * Create a new admin note. `noteType` is required for new notes.
 * Admin-only (user_id=1)
 */
export async function createAdminNote(
  coordinate: [number, number],
  text: string,
  noteType: NoteType
): Promise<AdminNote> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const [lng, lat] = coordinate;

  const result = await pool.query<AdminNoteRow>(`
    INSERT INTO admin_notes (coordinate, text, note_type)
    VALUES (ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, $4)
    RETURNING
      id,
      ST_AsGeoJSON(coordinate)::json as coordinate,
      text,
      note_type,
      created_at,
      updated_at
  `, [lng, lat, text, noteType]);

  return rowToNote(result.rows[0]);
}

/**
 * Update an existing admin note. `noteType` may be null to clear the type
 * (e.g. during admin backfill), or a specific type.
 * Admin-only (user_id=1)
 */
export async function updateAdminNote(
  id: number,
  text: string,
  noteType: NoteType | null
): Promise<AdminNote> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await pool.query<AdminNoteRow>(`
    UPDATE admin_notes
    SET text = $1, note_type = $2
    WHERE id = $3
    RETURNING
      id,
      ST_AsGeoJSON(coordinate)::json as coordinate,
      text,
      note_type,
      created_at,
      updated_at
  `, [text, noteType, id]);

  if (result.rows.length === 0) {
    throw new Error('Note not found');
  }

  return rowToNote(result.rows[0]);
}

/**
 * Delete an admin note
 * Admin-only (user_id=1)
 */
export async function deleteAdminNote(id: number): Promise<void> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await pool.query(`
    DELETE FROM admin_notes
    WHERE id = $1
  `, [id]);

  if (result.rowCount === 0) {
    throw new Error('Note not found');
  }
}
