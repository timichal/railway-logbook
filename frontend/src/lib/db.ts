import { Client, Pool } from 'pg';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'railways',
  user: process.env.DB_USER || 'railways_user',
  password: process.env.DB_PASSWORD || 'railways_pass'
};

// Create a connection pool for better performance
const pool = new Pool(dbConfig);

export async function query(text: string, params?: any[]) {
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