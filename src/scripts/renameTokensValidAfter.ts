#!/usr/bin/env tsx
/**
 * Rename `users.password_changed_at` to `tokens_valid_after`
 *
 * The column is the cutoff every token is held against (`sessionQueries.ts`), and
 * a password change is no longer the only thing that moves it: "Sign out other
 * devices" does too (`signOutOtherSessions`). The values are kept, so nobody is
 * signed out by the migration.
 *
 * A rename, so the app before it and the app after it each fail every signed-in
 * request while the database has the other's column: run it together with the
 * deploy. Idempotent — safe to re-run.
 */

import pool from "../lib/db";

async function renameTokensValidAfter() {
  const client = await pool.connect();

  try {
    console.log("Renaming users.password_changed_at to tokens_valid_after...");

    const existing = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'users'
         AND column_name IN ('password_changed_at', 'tokens_valid_after')`,
    );
    const columns = new Set(existing.rows.map((row) => row.column_name));

    if (columns.has("tokens_valid_after")) {
      console.log("✓ users.tokens_valid_after is already in place");
    } else if (columns.has("password_changed_at")) {
      await client.query(
        "ALTER TABLE users RENAME COLUMN password_changed_at TO tokens_valid_after",
      );
      console.log("✓ Renamed; every cutoff kept");
    } else {
      await client.query("ALTER TABLE users ADD COLUMN tokens_valid_after TIMESTAMPTZ");
      console.log("✓ users.tokens_valid_after added (there was no password_changed_at)");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

renameTokensValidAfter().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
