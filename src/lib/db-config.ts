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
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.POSTGRES_DB || '',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || ''
  };
}

/**
 * Database configuration - initialized at module load time for the application
 * For scripts that use dotenv, call getDbConfig() after dotenv.config()
 */
export const dbConfig: DbConfig = getDbConfig();
