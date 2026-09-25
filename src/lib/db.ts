import { Pool } from "pg";
import { dbConfig } from "./dbConfig";

// Create a connection pool for better performance
const pool = new Pool(dbConfig);

// An idle connection that dies (Postgres restarted, an idle timeout) is reported
// as an 'error' on the pool. Unlistened, that is an uncaught exception, and it
// would take the whole Next process down with it; the pool has already dropped
// the connection and opens a new one on the next query.
pool.on("error", (error) => {
  console.error("Idle database connection failed:", error.message);
});

export async function query(text: string, params?: unknown[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

export default pool;

/**
 * Escape the LIKE/ILIKE metacharacters in a user's search string before it is
 * wrapped in `%…%`.
 *
 * The value is parameterized, so this is not about injection: an unescaped `%`
 * or `_` simply makes the search mean something else (a lone `%` matches every
 * row), and a leading wildcard is also what stops the pattern using an index.
 * Backslash goes first because it is LIKE's own escape character, which is what
 * lets the other two be escaped at all.
 */
export function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
