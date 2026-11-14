/**
 * The web session's cookie, as the route handlers read it: the tile handlers
 * under `api/tiles`, the signed-in page's reads under `api/me` and the admin
 * page's under `api/admin`. This is the
 * one place they do (`api/session`, which also renews it, reads it itself). Not
 * `authActions.getUser`, which is a `"use server"` module a route handler must
 * not import.
 *
 * Reading the cookie in a GET is safe for the reasons the route tile handler
 * gives: a read that changes nothing, a `SameSite=Lax` cookie, and no CORS
 * headers, so another site can neither send it nor read the answer.
 */

import { cookies } from "next/headers";
import { isAdmin } from "../adminUser";
import { COOKIE_NAME, readToken, type TokenClaims, type User } from "../authTokens";
import { SIGNED_OUT_MESSAGE } from "../errors";
import { verifyToken } from "../sessionQueries";
import { ApiError, apiHandler, noStoreJson } from "./response";

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
 * The body of every admin read under `api/admin`: refuses anyone but the admin
 * (user 1), held against the account as `requireSessionUser` holds any session,
 * then answers `read`'s result as `sessionJson`, through `apiHandler`. No
 * session is a 401, someone else's a 403, as on the admin notes tiles.
 *
 * The check lives inside the wrapper, as `asAdmin`'s does for an admin server
 * action, so an admin read cannot be written without it. Parse the request
 * inside `read`, so a malformed one is refused only after the admin check.
 */
export function adminRead(read: () => Promise<unknown>): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireSessionUser();
    if (!isAdmin(user)) throw new ApiError(403, "Admin access required");
    return sessionJson(await read());
  });
}

/**
 * A signed-in user's own data as JSON. `private, no-store`: it answers per
 * session, so no shared cache may keep it, and the page asks again whenever it
 * wants it fresh.
 */
export function sessionJson(data: unknown): Response {
  return noStoreJson(data);
}
