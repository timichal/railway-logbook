/**
 * The web session's cookie, as signing in sets it (`authActions.ts`) and
 * `/api/session` renews it. A plain module because both need it, and a route
 * handler must not import a `"use server"` one.
 */

import { SESSION_TTL_SECONDS } from "./authTokens";

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  // Matching the token's own TTL
  maxAge: SESSION_TTL_SECONDS,
} as const;

/** How old a cookie gets before `/api/session` swaps it for a fresh one. */
export const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
