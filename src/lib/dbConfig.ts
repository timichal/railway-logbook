import { types } from "pg";

// A DATE (journey dates) is a calendar day, not an instant. pg's default parser
// turns it into a `Date` at the *server's* local midnight, which then serialises
// as the previous day's evening in UTC (`"2026-09-24T22:00:00.000Z"` at UTC+2) and
// is shifted again by whichever timezone reads it. Keep Postgres' own YYYY-MM-DD.
// The parser table is global to `pg`; it is set here because every pool, the
// app's, the tile pool and the scripts' alike, is built from this module.
types.setTypeParser(types.builtins.DATE, (value) => value);

/**
 * Shared database configuration
 * Used by both the application (Pool) and scripts (Client)
 */

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Get database configuration from environment variables
 * This is a function to ensure environment variables are loaded before accessing them
 */
export function getDbConfig(): DbConfig {
  return {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.POSTGRES_DB || "",
    user: process.env.DB_USER || "",
    password: process.env.DB_PASSWORD || "",
  };
}

/**
 * Database configuration - initialized at module load time for the application
 * For scripts that use dotenv, call getDbConfig() after dotenv.config()
 */
export const dbConfig: DbConfig = getDbConfig();
