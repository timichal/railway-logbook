/**
 * The admin page's reads of admin notes: the region's list and one note. A plain
 * module for the reason `adminRouteQueries.ts` gives; the `api/admin` handlers
 * check the admin before calling it. The writes (`adminNotesActions.ts`) return
 * their notes through the same columns and `rowToNote`.
 */

import { lngLatSql } from "./coordinateUtils";
import pool from "./db";
import { type RegionId, regionContainsSql } from "./shared/regions";
import type { AdminNote } from "./shared/types";

export type AdminNoteRow = Omit<AdminNote, "created_at" | "updated_at"> & {
  created_at: Date;
  updated_at: Date;
};

export const NOTE_COLUMNS = `id, ${lngLatSql("coordinate")} AS coordinate, text, note_type, source, created_at, updated_at`;

export function rowToNote(row: AdminNoteRow): AdminNote {
  return {
    ...row,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** The region's admin notes, most recently changed first. */
export async function adminNotes(region: RegionId): Promise<AdminNote[]> {
  const result = await pool.query<AdminNoteRow>(`
    SELECT ${NOTE_COLUMNS}
    FROM admin_notes
    WHERE ${regionContainsSql(region, "coordinate")}
    ORDER BY updated_at DESC
  `);

  return result.rows.map(rowToNote);
}

/**
 * One admin note, or null when there is none: a note deleted a moment ago is
 * still drawn until its tile reloads, and the popup says so rather than failing.
 */
export async function adminNote(id: number): Promise<AdminNote | null> {
  const result = await pool.query<AdminNoteRow>(
    `
    SELECT ${NOTE_COLUMNS}
    FROM admin_notes
    WHERE id = $1
  `,
    [id],
  );

  const row = result.rows[0];
  return row ? rowToNote(row) : null;
}
