/**
 * How a server action hands a rejection meant for the user back to the web app.
 *
 * It has to be *returned*: a production build replaces the message of anything
 * thrown out of a server function with a generic "An error occurred in the
 * Server Components render", so a thrown "Route not found" reads the same as a
 * crash. Only the classes whose messages are written for the user are caught;
 * anything else still throws and stays opaque, as it should — a Postgres error
 * text is for the log.
 *
 * A plain module rather than a `"use server"` one: `unwrap` runs on the client.
 */

import { NotFoundError, RateLimitError, ValidationError } from "./errors";

export type ActionResult<T> =
  | { value: T; error?: undefined }
  | { value?: undefined; error: string; notFound?: true };

export async function asActionResult<T>(attempt: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { value: await attempt() };
  } catch (error) {
    if (error instanceof NotFoundError) return { error: error.message, notFound: true };
    if (error instanceof ValidationError || error instanceof RateLimitError) {
      return { error: error.message };
    }
    throw error;
  }
}

/** A rejection an action returned for the user to read, re-thrown on the client by `unwrap`. */
export class ActionError extends Error {
  /**
   * What was asked for doesn't exist (any more) — a `NotFoundError` on the
   * server, or a journey gone from localStorage — so whatever was kept for it on
   * the client can go too.
   */
  readonly notFound: boolean;

  constructor(message: string, notFound = false) {
    super(message);
    this.name = "ActionError";
    this.notFound = notFound;
  }
}

/**
 * The client half: turns a returned rejection back into a thrown `ActionError`.
 * It is thrown on the client, so its message survives, and a call site's
 * existing `catch` shows it (through `actionErrorMessage`).
 */
export function unwrap<T>(result: ActionResult<T>): T {
  if (result.error !== undefined) {
    throw new ActionError(result.error, result.notFound === true);
  }
  return result.value as T;
}

/**
 * What a toast should say about an action that failed: the action's own message
 * when it returned one, and `fallback` for anything else. The rest is not written
 * for a user — a dropped connection reads "Failed to fetch", and anything thrown
 * out of a server function reads as the production build's long generic notice.
 */
export function actionErrorMessage(error: unknown, fallback = "Unknown error"): string {
  return error instanceof ActionError ? error.message : fallback;
}
