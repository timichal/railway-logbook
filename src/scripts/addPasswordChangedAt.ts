#!/usr/bin/env tsx
/**
 * Add `users.password_changed_at`, against which every token is now checked
 * (`src/lib/sessionQueries.ts`). Existing rows are left NULL, which
 * keeps every session already issued: nobody is signed out by the migration.
 *
 * Run it before deploying the code that reads the column — until then, every
 * authenticated request fails on the missing column. Idempotent.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";

dotenv.config();

const pool = new Pool(getDbConfig());

async function addPasswordChangedAt() {
  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ");
    console.log("✓ users.password_changed_at is in place");
  } finally {
    await pool.end();
  }
}

addPasswordChangedAt().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
