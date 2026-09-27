/**
 * How a server action hands a rejection meant for the user back to the web app.
 *
 * It has to be *returned*: a production build replaces the message of anything
 * thrown out of a server function with a generic "An error occurred in the
 * Server Components render", so a thrown "Route not found" reads the same as a
 * crash. Only the two classes whose messages are written for the user are
 * caught; anything else still throws and stays opaque, as it should — a
 * Postgres error text is for the log.
 *
 * A plain module rather than a `"use server"` one: `unwrap` runs on the client.
 */

import { RateLimitError, ValidationError } from "./errors";

export type ActionResult<T> =
  | { value: T; error?: undefined }
  | { value?: undefined; error: string };

export async function asActionResult<T>(attempt: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { value: await attempt() };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof RateLimitError) {
      return { error: error.message };
    }
    throw error;
  }
}

/**
 * The client half: turns a returned rejection back into a thrown `Error`. It is
 * thrown on the client, so its message survives, and a call site's existing
 * `catch` shows it exactly as it shows a failed request.
 */
export function unwrap<T>(result: ActionResult<T>): T {
  if (result.error !== undefined) {
    throw new Error(result.error);
  }
  return result.value as T;
}
