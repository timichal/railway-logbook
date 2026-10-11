/**
 * Response and error plumbing for the HTTP API under `src/app/api/v1`.
 *
 * The API exists for the native app (MOBILE_APP_PLAN.md, Phase 1). Every
 * handler is wrapped in `apiHandler`, so a thrown `ApiError` becomes its status,
 * the query modules' own error classes (`errors.ts`) theirs, and anything else
 * becomes a 500 with the detail logged rather than returned —
 * the query modules' messages are written for a user, an unexpected exception's
 * is not.
 */

import { NotFoundError, RateLimitError, ValidationError } from "../errors";

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

export function errorResponse(status: number, message: string, headers?: HeadersInit): Response {
  return Response.json({ error: message }, { status, headers });
}

/**
 * Run a handler body, mapping thrown errors to responses.
 *
 * `ApiError` carries its own status, `ValidationError` is a 400 and
 * `NotFoundError` a 404 — those messages are written for whoever asked. A
 * `RateLimitError` is the 429 its own name says, and carries the `Retry-After`
 * the client is meant to obey.
 * Anything else is a bug: logged in full, returned as an opaque 500, because a
 * Postgres error text is not advice to hand a client.
 */
export async function apiHandler(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResponse(error.status, error.message);
    }
    if (error instanceof RateLimitError) {
      return errorResponse(429, error.message, {
        "Retry-After": String(error.retryAfterSeconds),
      });
    }
    if (error instanceof ValidationError) {
      return errorResponse(400, error.message);
    }
    if (error instanceof NotFoundError) {
      return errorResponse(404, error.message);
    }
    console.error("API handler failed:", error);
    return errorResponse(500, "Internal server error");
  }
}
