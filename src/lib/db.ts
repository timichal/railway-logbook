import { Pool } from 'pg';
import { dbConfig } from './db-config';

// Create a connection pool for better performance
const pool = new Pool(dbConfig);

export async function query(text: string, params?: unknown[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

export async function getClient() {
  return await pool.connect();
}

export default pool;
