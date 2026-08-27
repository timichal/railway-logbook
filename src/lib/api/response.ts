/**
 * Response and error plumbing for the HTTP API under `src/app/api/v1`.
 *
 * The API exists for the native app (MOBILE_APP_PLAN.md, Phase 1). Every
 * handler is wrapped in `apiHandler`, so a thrown `ApiError` becomes its status
 * and anything else becomes a 500 with the detail logged rather than returned —
 * the query modules' messages are written for a user, an unexpected exception's
 * is not.
 */

import { ValidationError } from "../errors";

/** An error whose status code the client is meant to see. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function errorResponse(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/**
 * The status for an in-band `{ error }` message.
 *
 * The query modules report failure as a message rather than by throwing (the
 * web callers render it directly), so HTTP status has to be recovered from the
 * text. It is stringly-typed, which is why the vocabulary is kept small: the
 * "Failed to …" prefix is what those modules use for an unexpected database
 * error, "not found" for a row that isn't the caller's, and everything else is
 * a validation message.
 */
export function statusForMessage(message: string): number {
  if (/not authenticated/i.test(message)) return 401;
  if (/not found/i.test(message)) return 404;
  if (/^failed to/i.test(message)) return 500;
  return 400;
}

/** Turn an in-band `{ error }` result into the matching HTTP failure. */
export function assertOk(result: { error?: string }): void {
  if (result.error) {
    throw new ApiError(statusForMessage(result.error), result.error);
  }
}

/**
 * Run a handler body, mapping thrown errors to responses.
 *
 * `ApiError` carries its own status and `ValidationError` is a 400 — those two
 * messages are written for whoever asked. Anything else is a bug: logged in
 * full, returned as an opaque 500, because a Postgres error text is not advice
 * to hand a client.
 */
export async function apiHandler(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResponse(error.status, error.message);
    }
    if (error instanceof ValidationError) {
      return errorResponse(400, error.message);
    }
    console.error("API handler failed:", error);
    return errorResponse(500, "Internal server error");
  }
}
