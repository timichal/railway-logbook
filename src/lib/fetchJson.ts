/**
 * The web page's side of its own route handlers (`api/me`, `api/public`): a JSON
 * answer, or the `{ error }` body `apiHandler` writes thrown as an `ActionError`,
 * so call sites read a refusal exactly as they read an `unwrap`ped action
 * (`actionErrorMessage`; `notFound` on a 404).
 */

import { ActionError } from "./actionResult";

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.ok) return (await response.json()) as T;

  const body: unknown = await response.json().catch(() => null);
  const message =
    body !== null && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : null;
  // Only a message the handler wrote for the user is one; a 500's is opaque anyway
  if (message !== null && response.status < 500) {
    throw new ActionError(message, response.status === 404);
  }
  throw new Error(`${url.split("?")[0]}: HTTP ${response.status}`);
}

/** A query string from the parameters that are set; an undefined one is left out. */
export function queryString(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) query.set(name, value);
  }
  return query.toString();
}

/** A JSON POST: for a read whose argument is a list too long for a query string. */
export function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
