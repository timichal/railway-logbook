/**
 * A failure whose message is written for whoever asked — a rejected password, a
 * name left blank — as opposed to an exception, whose message is for the log.
 *
 * The distinction is what lets one thrown error be shown to a user and another
 * be swallowed: the web forms render `error.message` either way (they always
 * did), and the HTTP API maps this class to a 400 while anything else becomes an
 * opaque 500. Without it a Postgres error text would be handed to a client as
 * though it were advice.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
