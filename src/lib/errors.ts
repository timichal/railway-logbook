/**
 * A failure whose message is written for whoever asked — a rejected password, a
 * name left blank — as opposed to an exception, whose message is for the log.
 *
 * The distinction is what lets one thrown error be shown to a user and another
 * be swallowed: the HTTP API maps this class to a 400 (and `NotFoundError` to a
 * 404) while anything else becomes an opaque 500. Without it a Postgres error text would be handed to a client as
 * though it were advice.
 *
 * On the web, throwing it is not enough: a production build replaces the message
 * of anything thrown out of a server function, so a thrown message never reaches
 * a form. A web action has to catch it and *return* `{ error }` — which is what
 * `asActionResult` (`actionResult.ts`) is for.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * A signed-in action's refusal when there is no session: the page offers those
 * actions only while signed in, so the session ended under it.
 */
export const SIGNED_OUT_MESSAGE = "You've been signed out. Sign in again to continue.";

/**
 * A row the caller asked for that isn't there — or isn't theirs, which answers
 * the same so that an id cannot be probed for. Its message is written for the
 * caller like a `ValidationError`'s; it is a class of its own only because the
 * HTTP API owes it a 404 rather than a 400.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * A refusal to even try, because the caller has asked too often — see
 * `rateLimit.ts`. Separate from `ValidationError` because it is not a complaint
 * about the input: the HTTP API owes it a 429 and a `Retry-After`, which is the
 * only thing a native client can act on, while a web action returns its message
 * like any other.
 */
export class RateLimitError extends Error {
  constructor(
    readonly retryAfterSeconds: number,
    message: string,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}
