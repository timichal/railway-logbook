'use server';

import pool from './db';
import { getUser } from './authActions';
import type { AdminNote } from './types';

/**
 * Get all admin notes
 * Admin-only (user_id=1)
 */
export async function getAllAdminNotes(): Promise<AdminNote[]> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await pool.query<{
    id: number;
    coordinate: { coordinates: [number, number] };
    text: string;
    created_at: Date;
    updated_at: Date;
  }>(`
    SELECT
      id,
      ST_AsGeoJSON(coordinate)::json as coordinate,
      text,
      created_at,
      updated_at
    FROM admin_notes
    ORDER BY updated_at DESC
  `);

  return result.rows.map(row => ({
    id: row.id,
    coordinate: row.coordinate.coordinates,
    text: row.text,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }));
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

  const result = await pool.query<{
    id: number;
    coordinate: { coordinates: [number, number] };
    text: string;
    created_at: Date;
    updated_at: Date;
  }>(`
    SELECT
      id,
      ST_AsGeoJSON(coordinate)::json as coordinate,
      text,
      created_at,
      updated_at
    FROM admin_notes
    WHERE id = $1
  `, [id]);

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    coordinate: row.coordinate.coordinates,
    text: row.text,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Create a new admin note
 * Admin-only (user_id=1)
 */
export async function createAdminNote(
  coordinate: [number, number],
  text: string
): Promise<AdminNote> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const [lng, lat] = coordinate;

  const result = await pool.query<{
    id: number;
    coordinate: { coordinates: [number, number] };
    text: string;
    created_at: Date;
    updated_at: Date;
  }>(`
    INSERT INTO admin_notes (coordinate, text)
    VALUES (ST_SetSRID(ST_MakePoint($1, $2), 4326), $3)
    RETURNING
      id,
      ST_AsGeoJSON(coordinate)::json as coordinate,
      text,
      created_at,
      updated_at
  `, [lng, lat, text]);

  const row = result.rows[0];
  return {
    id: row.id,
    coordinate: row.coordinate.coordinates,
    text: row.text,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * Update an existing admin note
 * Admin-only (user_id=1)
 */
export async function updateAdminNote(
  id: number,
  text: string
): Promise<AdminNote> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await pool.query<{
    id: number;
    coordinate: { coordinates: [number, number] };
    text: string;
    created_at: Date;
    updated_at: Date;
  }>(`
    UPDATE admin_notes
    SET text = $1
    WHERE id = $2
    RETURNING
      id,
      ST_AsGeoJSON(coordinate)::json as coordinate,
      text,
      created_at,
      updated_at
  `, [text, id]);

  if (result.rows.length === 0) {
    throw new Error('Note not found');
  }

  const row = result.rows[0];
  return {
    id: row.id,
    coordinate: row.coordinate.coordinates,
    text: row.text,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
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
