/**
 * The token pair, in the keychain / Android keystore.
 *
 * `expo-secure-store` rather than `AsyncStorage` because these are bearer
 * credentials: the API has no server-side revocation, so a leaked refresh token is
 * good for its full 180 days (`API.md`).
 *
 * Reads are cached in memory. Every authenticated request needs the access token
 * and each SecureStore read crosses the native bridge, so the cache is what keeps
 * that off the request path; it is the single writer, so it cannot go stale.
 */
import * as SecureStore from "expo-secure-store";

const ACCESS_KEY = "railwayLogbook.accessToken";
const REFRESH_KEY = "railwayLogbook.refreshToken";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** `undefined` = the keychain has not been read yet; `null` = read, and empty. */
let cached: TokenPair | null | undefined;

export async function loadTokens(): Promise<TokenPair | null> {
  if (cached !== undefined) return cached;

  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);

  // A half-written pair is no pair: without a refresh token an expired access
  // token is unrecoverable, and without an access token there is nothing to send.
  cached = accessToken && refreshToken ? { accessToken, refreshToken } : null;
  return cached;
}

export async function saveTokens(pair: TokenPair): Promise<void> {
  cached = pair;
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, pair.accessToken),
    SecureStore.setItemAsync(REFRESH_KEY, pair.refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  cached = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}
