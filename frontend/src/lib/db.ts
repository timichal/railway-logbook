import { Pool } from 'pg';

const dbConfig = {
  host: 'localhost',
  port: 5432,
  database: 'railmap',
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || ''
};

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
