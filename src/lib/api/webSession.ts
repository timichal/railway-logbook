/**
 * The web session's cookie, as the route handlers read it: the tile handlers
 * under `api/tiles` and the signed-in page's reads under `api/me`. This is the
 * one place they do (`api/session`, which also renews it, reads it itself). Not
 * `authActions.getUser`, which is a `"use server"` module a route handler must
 * not import.
 *
 * Reading the cookie in a GET is safe for the reasons the route tile handler
 * gives: a read that changes nothing, a `SameSite=Lax` cookie, and no CORS
 * headers, so another site can neither send it nor read the answer.
 */

import { cookies } from "next/headers";
import { COOKIE_NAME, readToken, type TokenClaims, type User } from "../authTokens";
import { SIGNED_OUT_MESSAGE } from "../errors";
import { verifyToken } from "../sessionQueries";
import { ApiError } from "./response";

async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE_NAME)?.value;
}

/**
 * What the session cookie claims, or null.
 *
 * Signature checked, **not** held against the account: the tile query does that
 * (`currentAccountIdSql`), so a tile stays one round trip on the tile pool.
 * Anything that isn't a tile wants `requireSessionUser`.
 */
export async function sessionClaims(): Promise<TokenClaims | null> {
  const token = await sessionToken();
  return token ? readToken(token) : null;
}

/**
 * The session's user, held against the account as a server action's `getUser`
 * is, or a 401 saying the session ended (the page asks only while signed in).
 */
export async function requireSessionUser(): Promise<User> {
  const token = await sessionToken();
  const user = token ? await verifyToken(token) : null;
  if (!user) throw new ApiError(401, SIGNED_OUT_MESSAGE);
  return user;
}

/**
 * A signed-in user's own data as JSON. `private, no-store`: it answers per
 * session, so no shared cache may keep it, and the page asks again whenever it
 * wants it fresh.
 */
export function sessionJson(data: unknown): Response {
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
