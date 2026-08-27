/**
 * Bearer-token auth for the HTTP API.
 *
 * The web app keeps its httpOnly cookie; the native app has no cookie jar worth
 * relying on and holds a token in `expo-secure-store` instead
 * (MOBILE_APP_PLAN.md, Phase 1). Only the `Authorization` header is read here —
 * deliberately not the cookie, so a browser session can never drive a mutating
 * API call it didn't mean to make.
 *
 * The signing is shared with the web session (`authTokens.ts`): one secret, one
 * claim shape, two transports.
 */

import {
  ACCESS_TOKEN_TTL_SECONDS,
  createAccessToken,
  createRefreshToken,
  type User,
  verifyToken,
} from "../authTokens";
import { ApiError } from "./response";

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** The request's user, or null if it carries no usable access token. */
export async function userFromRequest(request: Request): Promise<User | null> {
  const token = bearerToken(request);
  if (!token) return null;

  return verifyToken(token, "access");
}

/** The request's user, or a 401. */
export async function requireUser(request: Request): Promise<User> {
  const user = await userFromRequest(request);
  if (!user) {
    throw new ApiError(401, "Authentication required");
  }
  return user;
}

/** The user named by a refresh token in the body, or a 401. */
export async function userFromRefreshToken(token: unknown): Promise<User> {
  if (typeof token !== "string" || !token) {
    throw new ApiError(400, "refreshToken is required");
  }

  const user = await verifyToken(token, "refresh");
  if (!user) {
    throw new ApiError(401, "Refresh token is invalid or expired");
  }
  return user;
}

/**
 * The token pair handed to a client that has just proved who it is.
 *
 * Two tokens because of how a logbook is used: the access token is short enough
 * that a leaked one expires, and the refresh token is long enough that opening
 * the app after a month of not travelling doesn't land on a login screen. They
 * are stateless, so there is no server-side revocation — logging out is the
 * client dropping both.
 */
export async function issueTokens(user: User): Promise<{
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken(user),
    createRefreshToken(user),
  ]);

  return { user, accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}
