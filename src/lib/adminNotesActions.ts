"use server";

import type { ActionResult } from "./actionResult";
import { asAdmin } from "./authHelpers";
import pool from "./db";
import { ValidationError } from "./errors";
import { type NoteType, noteTypeOptions } from "./shared/constants";
import { type RegionId, regionEnvelopeSql } from "./shared/regions";
import type { AdminNote } from "./shared/types";

type AdminNoteRow = {
  id: number;
  coordinate: { coordinates: [number, number] };
  text: string;
  note_type: NoteType;
  source: string | null;
  created_at: Date;
  updated_at: Date;
};

function rowToNote(row: AdminNoteRow): AdminNote {
  return {
    id: row.id,
    coordinate: row.coordinate.coordinates,
    text: row.text,
    note_type: row.note_type,
    source: row.source,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * The popup trims and validates before it calls, but every export here is an
 * endpoint, and a constraint violation would reach the admin as the generic
 * production error — so the checks are repeated where they are answerable.
 */
function validNoteFields(
  text: string,
  noteType: NoteType,
  source: string | null,
): { text: string; noteType: NoteType; source: string | null } {
  const trimmedText = typeof text === "string" ? text.trim() : "";
  if (!trimmedText) {
    throw new ValidationError("Note text is required");
  }
  if (!noteTypeOptions.some((option) => option.id === noteType)) {
    throw new ValidationError(`Unknown note type: ${String(noteType)}`);
  }
  const trimmedSource = typeof source === "string" ? source.trim() : "";
  return { text: trimmedText, noteType, source: trimmedSource || null };
}

/**
 * Get the region's admin notes
 * Admin-only (user_id=1)
 */
export async function getAllAdminNotes(region: RegionId): Promise<ActionResult<AdminNote[]>> {
  return asAdmin(async () => {
    const result = await pool.query<AdminNoteRow>(`
    SELECT
      id,
      ST_AsGeoJSON(coordinate)::json as coordinate,
      text,
      note_type,
      source,
      created_at,
      updated_at
    FROM admin_notes
    WHERE coordinate && ${regionEnvelopeSql(region)}
    ORDER BY updated_at DESC
  `);

    return result.rows.map(rowToNote);
  });
}

/**
 * Get a single admin note by ID
 * Admin-only (user_id=1)
 */
export async function getAdminNote(id: number): Promise<ActionResult<AdminNote | null>> {
  return asAdmin(async () => {
    const result = await pool.query<AdminNoteRow>(
      `
    SELECT
      id,
      ST_AsGeoJSON(coordinate)::json as coordinate,
      text,
      note_type,
      source,
      created_at,
      updated_at
    FROM admin_notes
    WHERE id = $1
  `,
      [id],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToNote(result.rows[0]);
  });
}

/**
 * Create a new admin note. `noteType` is required for new notes.
 * Admin-only (user_id=1)
 */
export async function createAdminNote(
  coordinate: [number, number],
  text: string,
  noteType: NoteType,
  source: string | null = null,
): Promise<ActionResult<AdminNote>> {
  return asAdmin(async () => {
    const [lng, lat] = coordinate;
    const fields = validNoteFields(text, noteType, source);

    const result = await pool.query<AdminNoteRow>(
      `
    INSERT INTO admin_notes (coordinate, text, note_type, source)
    VALUES (ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, $4, $5)
    RETURNING
      id,
      ST_AsGeoJSON(coordinate)::json as coordinate,
      text,
      note_type,
      source,
      created_at,
      updated_at
  `,
      [lng, lat, fields.text, fields.noteType, fields.source],
    );

    return rowToNote(result.rows[0]);
  });
}

/**
 * Update an existing admin note. `noteType` is required — every note has one.
 * Admin-only (user_id=1)
 */
export async function updateAdminNote(
  id: number,
  text: string,
  noteType: NoteType,
  source: string | null = null,
): Promise<ActionResult<AdminNote>> {
  return asAdmin(async () => {
    const fields = validNoteFields(text, noteType, source);
    const result = await pool.query<AdminNoteRow>(
      `
    UPDATE admin_notes
    SET text = $1, note_type = $2, source = $3
    WHERE id = $4
    RETURNING
      id,
      ST_AsGeoJSON(coordinate)::json as coordinate,
      text,
      note_type,
      source,
      created_at,
      updated_at
  `,
      [fields.text, fields.noteType, fields.source, id],
    );

    if (result.rows.length === 0) {
      throw new ValidationError("Note not found");
    }

    return rowToNote(result.rows[0]);
  });
}

/**
 * Delete an admin note
 * Admin-only (user_id=1)
 */
export async function deleteAdminNote(id: number): Promise<ActionResult<void>> {
  return asAdmin(async () => {
    const result = await pool.query(
      `
    DELETE FROM admin_notes
    WHERE id = $1
  `,
      [id],
    );

    if (result.rowCount === 0) {
      throw new ValidationError("Note not found");
    }
  });
}
