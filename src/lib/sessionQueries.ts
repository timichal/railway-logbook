/**
 * Whether a token still stands: the account half of verifying it.
 *
 * The cookie and the app's access and refresh tokens are JWTs carrying only the
 * user, so a signature check alone (`readToken` in `authTokens.ts`) could take
 * nothing back short of rotating `JWT_SECRET`, which signs out everyone —
 * `createAdmin --reset` could not reclaim the admin from whoever was already
 * signed in as it, and a 180-day refresh token kept renewing that. So a token is
 * also held against its account: refused if it was issued before
 * `users.password_changed_at`, or if the account no longer exists.
 *
 * The rule is written once, as SQL (`currentAccountIdSql`). `verifyToken` runs it
 * on its own for the cookie, the bearer and the refresh; the tile handlers embed
 * it in the tile query instead, so a tile costs one round trip on the tile pool,
 * as a shared map's already does.
 */

import { readToken, type TokenClaims, type User } from "./authTokens";
import { query } from "./db";

/**
 * The rule as SQL: the id of the user in `userIdParam`, or NULL unless that
 * account exists and has not changed its password since `issuedAtMsParam`
 * (milliseconds, as `TokenClaims.issuedAtMs` — pass it through `issuedAtParam`).
 * A NULL `password_changed_at` is a password unchanged since the column was
 * added, and every token for it stands.
 *
 * The change is truncated to the millisecond to meet the token on its own
 * terms, which lets a token issued in the very millisecond of the change stand.
 */
export function currentAccountIdSql(userIdParam: string, issuedAtMsParam: string): string {
  return `(SELECT id FROM users
           WHERE id = ${userIdParam}
             AND (password_changed_at IS NULL
                  OR floor(extract(epoch FROM password_changed_at) * 1000) <= ${issuedAtMsParam}::bigint))`;
}

/** `TokenClaims.issuedAtMs` as the bigint parameter `currentAccountIdSql` takes. */
export function issuedAtParam(claims: TokenClaims): number {
  return Math.floor(claims.issuedAtMs);
}

/**
 * Verify a token and return its user as the account has it now, or null.
 *
 * The email and name come from the row rather than from the token, so a refresh
 * mints its new pair from the account and not from claims that may be months old.
 * A database fault throws: it is not a bad token and must not pass for "logged out".
 */
export async function verifyToken(
  token: string,
  expect: "session" | "access" | "refresh" = "session",
): Promise<User | null> {
  const claims = await readToken(token, expect);
  if (!claims) return null;

  const result = await query(
    `SELECT id, email, name FROM users WHERE id = ${currentAccountIdSql("$1", "$2")}`,
    [claims.userId, issuedAtParam(claims)],
  );

  const row = result.rows[0];
  return row ? { id: row.id, email: row.email, name: row.name } : null;
}
