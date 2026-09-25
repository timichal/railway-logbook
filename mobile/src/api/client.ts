/**
 * The HTTP client for `/api/v1` (see `API.md`).
 *
 * Two things it owns beyond `fetch`:
 *
 * - **The bearer token**, read from `tokenStore` rather than passed in, so no screen
 *   has to know a request is authenticated.
 * - **The refresh dance.** A 401 on an authenticated call means the 7-day access
 *   token has expired, which is expected — a logbook is opened when a trip happens.
 *   The call refreshes once and retries; a failure there is a real sign-out, and is
 *   reported to whoever registered `onSignedOut` (the auth context) rather than
 *   thrown at whichever screen happened to make the call.
 *
 * The refresh is **single-flight**: a screen that fires three requests at once on a
 * cold start would otherwise send three refreshes, and since each one issues a new
 * pair (`API.md`), the last write would win and the other two responses would be
 * discarded — leaving tokens in the keychain that no reply ever confirmed.
 */

import { clearTokens, loadTokens, saveTokens, type TokenPair } from "@/auth/tokenStore";
import { API_BASE_URL } from "@/config";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown when the device has no usable connection to the API at all. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("Could not reach the server. Check your connection and try again.");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

export interface AuthResponse extends TokenPair {
  user: { id: number; email: string; name?: string };
  expiresIn: number;
}

type QueryValue = string | number | boolean | undefined;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Send the bearer token, and refresh-and-retry on a 401. Default true. */
  auth?: boolean;
  signal?: AbortSignal;
}

let signedOutListener: (() => void) | null = null;

/** Registered by the auth context: called when a refresh fails and the session is over. */
export function onSignedOut(listener: (() => void) | null): void {
  signedOutListener = listener;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A proxy error page or an HTML 502 — not something a caller can read.
    throw new ApiError(response.status, `Unexpected response from the server (${response.status})`);
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return `Request failed (${status})`;
}

async function send(
  path: string,
  options: RequestOptions,
  accessToken: string | null,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  try {
    return await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    // `fetch` rejects only on a transport failure; an abort is the caller's own doing.
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new NetworkError(error);
  }
}

/**
 * What came of a refresh. The third case is the one worth naming: a refresh that
 * never reached the server says nothing about whether the token is still good, and
 * this app is meant to be opened on a train — so "unreachable" keeps the pair and
 * reports a network failure, while only a server that actually rejected the token
 * ends the session.
 */
type RefreshResult =
  | { kind: "refreshed"; tokens: TokenPair }
  | { kind: "rejected" }
  | { kind: "unreachable"; error: unknown };

let refreshInFlight: Promise<RefreshResult> | null = null;

/** Swap the pair for a fresh one. Single-flight. */
function refresh(refreshToken: string): Promise<RefreshResult> {
  refreshInFlight ??= (async (): Promise<RefreshResult> => {
    try {
      const response = await send(
        "/auth/refresh",
        { method: "POST", body: { refreshToken }, auth: false },
        null,
      );
      // A 401 is the token being refused; a 500 is the server having a bad day and
      // is not grounds for throwing the session away.
      if (!response.ok) {
        return response.status === 401
          ? { kind: "rejected" }
          : { kind: "unreachable", error: new ApiError(response.status, "Refresh failed") };
      }

      const pair = (await parse(response)) as AuthResponse;
      const tokens = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
      await saveTokens(tokens);
      return { kind: "refreshed", tokens };
    } catch (error) {
      return { kind: "unreachable", error };
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const authenticated = options.auth !== false;
  const tokens = authenticated ? await loadTokens() : null;

  let response = await send(path, options, tokens?.accessToken ?? null);

  if (response.status === 401 && authenticated && tokens) {
    const result = await refresh(tokens.refreshToken);

    // The refresh never landed. The pair stays in the keychain — it may well still
    // be good — and the caller hears about the connection instead.
    if (result.kind === "unreachable") {
      throw result.error instanceof NetworkError ? result.error : new NetworkError(result.error);
    }

    if (result.kind === "refreshed") {
      response = await send(path, options, result.tokens.accessToken);
    }

    // Either the refresh token was refused, or a freshly minted access token was:
    // both mean the session is over, and it ends here rather than at whichever
    // screen made the call.
    if (result.kind === "rejected" || response.status === 401) {
      await clearTokens();
      signedOutListener?.();
      throw new ApiError(401, "Your session has expired. Please sign in again.");
    }
  }

  const body = await parse(response);
  if (!response.ok) throw new ApiError(response.status, errorMessage(body, response.status));

  return body as T;
}
