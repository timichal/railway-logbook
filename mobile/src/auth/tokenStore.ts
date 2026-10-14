/**
 * The session on the device: the token pair, when the access token runs out, and
 * who it belongs to — in the keychain / Android keystore.
 *
 * `expo-secure-store` rather than `AsyncStorage` because these are bearer
 * credentials: the API has no server-side revocation, so a leaked refresh token is
 * good for its full 180 days (`API.md`).
 *
 * Reads are cached in memory. Every authenticated request needs the access token
 * and each SecureStore read crosses the native bridge, so the cache is what keeps
 * that off the request path; it is the single writer, so it cannot go stale.
 *
 * Being the single writer is also why it moves the route tile's header
 * (`map/tileAuth.ts`): the map's tile requests carry the access token too, and
 * this is the one place every change of it passes through.
 *
 * **The expiry** is kept so the token can be replaced *before* it runs out
 * (`refreshIfExpiring` in `api/client.ts`): the API client refreshes on a 401 by
 * itself, but a route tile answered 401 is just drawn as nothing.
 *
 * **The user** is kept so a cold start with no connection can still open the app
 * signed in (`AuthContext`) — the tokens alone say nothing about whose they are
 * without asking the server. It is cleared with the tokens.
 */
import * as SecureStore from "expo-secure-store";
import type { ApiUser } from "@/api/client";
import { setTileAuthToken } from "@/map/tileAuth";

const ACCESS_KEY = "railwayLogbook.accessToken";
const REFRESH_KEY = "railwayLogbook.refreshToken";
const EXPIRES_KEY = "railwayLogbook.accessTokenExpiresAt";
const USER_KEY = "railwayLogbook.user";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** `undefined` = the keychain has not been read yet; `null` = read, and empty. */
let cached: TokenPair | null | undefined;
/** Epoch ms; null when unknown (a pair saved before this was kept). */
let cachedExpiresAt: number | null = null;

export async function loadTokens(): Promise<TokenPair | null> {
  if (cached !== undefined) return cached;

  const [accessToken, refreshToken, expiresAt] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
    SecureStore.getItemAsync(EXPIRES_KEY),
  ]);

  // A half-written pair is no pair: without a refresh token an expired access
  // token is unrecoverable, and without an access token there is nothing to send.
  cached = accessToken && refreshToken ? { accessToken, refreshToken } : null;
  const parsed = expiresAt ? Number(expiresAt) : Number.NaN;
  cachedExpiresAt = Number.isFinite(parsed) ? parsed : null;
  setTileAuthToken(cached?.accessToken ?? null);
  return cached;
}

/** When the access token held now runs out (epoch ms), or null if that is not known. */
export function accessTokenExpiresAt(): number | null {
  return cached ? cachedExpiresAt : null;
}

/** `expiresIn` is the auth response's, in seconds (`API.md`). */
export async function saveTokens(pair: TokenPair, expiresIn: number): Promise<void> {
  cached = pair;
  cachedExpiresAt = Date.now() + expiresIn * 1000;
  setTileAuthToken(pair.accessToken);
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, pair.accessToken),
    SecureStore.setItemAsync(REFRESH_KEY, pair.refreshToken),
    SecureStore.setItemAsync(EXPIRES_KEY, String(cachedExpiresAt)),
  ]);
}

export async function clearTokens(): Promise<void> {
  cached = null;
  cachedExpiresAt = null;
  setTileAuthToken(null);
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
    SecureStore.deleteItemAsync(EXPIRES_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}

/** The signed-in user as the server last described them. Never throws: it is a fallback. */
export async function saveUser(user: ApiUser): Promise<void> {
  try {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  } catch {
    // Without it, an offline cold start shows the login screen — as it always did.
  }
}

export async function loadUser(): Promise<ApiUser | null> {
  try {
    const stored = await SecureStore.getItemAsync(USER_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return null;
    const { id, email, name } = parsed as Partial<ApiUser>;
    return typeof id === "number" && typeof email === "string"
      ? { id, email, name: typeof name === "string" ? name : null }
      : null;
  } catch {
    return null;
  }
}
