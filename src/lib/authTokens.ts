/**
 * JWT minting and verification, and nothing else.
 *
 * A plain module rather than part of `authActions.ts` because two transports
 * need it: the web app's httpOnly cookie and the mobile app's bearer token
 * (see MOBILE_APP_PLAN.md, Phase 1). Keeping the secret and the claim shape in
 * one place is what stops the two drifting apart — a token minted for one has
 * to verify for the other, since both are the same user session.
 *
 * Nothing here touches `cookies()` or a request, so it is callable from a
 * server action, a route handler and a CLI script alike.
 */

import { jwtVerify, SignJWT } from "jose";

/**
 * Development only. It is in the repo, so a server signing with it lets anyone
 * who has read the repo forge `{ userId: 1 }`, i.e. admin.
 */
const DEV_FALLBACK_SECRET = "dev-only-jwt-secret-never-used-in-production";
/** HS256 wants a key at least as long as its 256-bit output. */
const MIN_SECRET_BYTES = 32;

/**
 * The signing key, or a throw in production when it is missing or short.
 *
 * `docker-compose.yml` passes `JWT_SECRET=${JWT_SECRET}`, which is an empty
 * string when the host variable is unset — so "unset" has to include empty.
 * Resolved on first use rather than at module load, because `next build` runs
 * with NODE_ENV=production and no secret, and may load this module to
 * prerender; `instrumentation.ts` calls it at server start instead, so a
 * misconfigured container dies on boot rather than on its first login.
 */
export function resolveJwtSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET ?? "";

  if (process.env.NODE_ENV === "production") {
    const bytes = new TextEncoder().encode(raw);
    if (bytes.length < MIN_SECRET_BYTES) {
      throw new Error(
        raw
          ? `JWT_SECRET is ${bytes.length} bytes; at least ${MIN_SECRET_BYTES} are required`
          : "JWT_SECRET is not set",
      );
    }
    return bytes;
  }

  return new TextEncoder().encode(raw || DEV_FALLBACK_SECRET);
}

let jwtSecret: Uint8Array | undefined;

function getJwtSecret(): Uint8Array {
  jwtSecret ??= resolveJwtSecret();
  return jwtSecret;
}

export const COOKIE_NAME = "railway-auth";

export interface User {
  id: number;
  email: string;
  name?: string;
}

/**
 * Token kinds.
 *
 * The web cookie carries no `typ` at all (it predates the split, and existing
 * cookies must keep working), so an absent claim reads as a session token.
 * `access` and `refresh` are the mobile pair: the access token is what every
 * request carries, the refresh token exists only to mint new ones — and a
 * refresh token must never be accepted as an access token, which is the whole
 * reason the claim exists.
 */
export type TokenKind = "session" | "access" | "refresh";

/** Web cookie session. Unchanged from before the mobile API existed. */
const SESSION_TTL = "7d";
/** Bearer token the app sends with every request. */
const ACCESS_TTL = "7d";
/**
 * Long, deliberately: a logbook is opened when a trip happens, which may be
 * once a month, and being logged out on a train is worse than useless.
 */
const REFRESH_TTL = "180d";

export const ACCESS_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function sign(user: User, kind: TokenKind, ttl: string): Promise<string> {
  const claims: Record<string, unknown> = { userId: user.id, email: user.email, name: user.name };
  if (kind !== "session") claims.typ = kind;

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(getJwtSecret());
}

/** The web app's cookie token. */
export function createToken(user: User): Promise<string> {
  return sign(user, "session", SESSION_TTL);
}

export function createAccessToken(user: User): Promise<string> {
  return sign(user, "access", ACCESS_TTL);
}

export function createRefreshToken(user: User): Promise<string> {
  return sign(user, "refresh", REFRESH_TTL);
}

/**
 * Verify a token and return its user, or null.
 *
 * `expect` is the kind the caller is willing to accept. A cookie session token
 * is accepted wherever an access token is, so a browser and the app can hit the
 * same handler; a refresh token is accepted only where it is explicitly asked
 * for, and never as an access token.
 */
export async function verifyToken(
  token: string,
  expect: "session" | "access" | "refresh" = "session",
): Promise<User | null> {
  // Outside the try: a missing secret is a server fault, not a bad token, and
  // must not pass for "logged out".
  const secret = getJwtSecret();
  try {
    const { payload } = await jwtVerify(token, secret);
    const kind = (payload.typ as TokenKind | undefined) ?? "session";

    if (expect === "refresh") {
      if (kind !== "refresh") return null;
    } else if (kind === "refresh") {
      return null;
    }

    return {
      id: payload.userId as number,
      email: payload.email as string,
      name: payload.name as string,
    };
  } catch {
    return null;
  }
}
