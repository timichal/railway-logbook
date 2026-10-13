import { Pool, type PoolClient, type PoolConfig } from "pg";
import { dbConfig } from "./dbConfig";
import { NotFoundError } from "./errors";

/**
 * A pool on the app's database, `overrides` on top of `dbConfig`. Every pool is
 * made here, so none can miss the listener: an idle connection that dies
 * (Postgres restarted, an idle timeout) is reported as an 'error' on the pool.
 * Unlistened, that is an uncaught exception, and it would take the whole process
 * down with it — the Next server, or a deploy part-way through its import; the
 * pool has already dropped the connection and opens a new one on the next query.
 */
export function createPool(overrides: PoolConfig = {}): Pool {
  const pool = new Pool({ ...dbConfig, ...overrides });
  pool.on("error", (error) => {
    console.error("Idle database connection failed:", error.message);
  });
  return pool;
}

const pool = createPool();

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

const MISSING_ROW_NAMES: Record<string, string> = {
  railway_routes: "Route",
  user_journeys: "Journey",
  user_trips: "Trip",
};

/**
 * `error` as the `NotFoundError` it means when it is a foreign key violation, and
 * unchanged otherwise.
 *
 * The ids a write references arrive from the client, so an unknown or deleted
 * route is the caller's mistake, not a server failure — and it answers like the
 * other rows that "aren't there".
 *
 * Told apart by the table the missing key was looked for in, which Postgres names
 * in the error's detail, rather than by constraint name: the ownership FKs were
 * added to existing databases by migration, and nothing guarantees their names
 * match `01-schema.sql`.
 */
export function asMissingRow(error: unknown): unknown {
  const pgError = error as { code?: string; detail?: string } | null;
  if (pgError?.code !== "23503") return error;
  const table = /is not present in table "([^"]+)"/.exec(pgError.detail ?? "")?.[1];
  const what = table ? MISSING_ROW_NAMES[table] : undefined;
  return what ? new NotFoundError(`${what} not found`) : error;
}

/**
 * Run `body` in a transaction on a connection of its own, rolling back on any
 * failure and rethrowing it unchanged. A caller whose ids come from the client
 * wants `asMissingRow` on top (see `journeyQueries.ts`); elsewhere a foreign key
 * violation is a fault, not a missing row.
 */
export async function withTransaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let brokenConnection: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await body(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // A failed ROLLBACK means the connection itself is gone (the likeliest
    // cause of the failure in the first place): keep the original error, and
    // have the pool discard the client rather than hand it to the next caller
    await client.query("ROLLBACK").catch((rollbackError: Error) => {
      brokenConnection = rollbackError;
    });
    throw error;
  } finally {
    client.release(brokenConnection);
  }
}

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
