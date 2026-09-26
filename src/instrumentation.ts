/**
 * Runs once when the server starts (Next's instrumentation convention; not
 * called during `next build`).
 *
 * Checks the JWT secret up front, so a production container started without
 * one exits on boot instead of serving pages until someone tries to log in.
 * The exit is explicit because a throw is not enough: a production Next server
 * only logs a failed `register()` ("Failed to prepare server") and then fails
 * every request with a 500, which leaves the container up and `restart: always`
 * with nothing to do.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resolveJwtSecret } = await import("@/lib/authTokens");
    try {
      resolveJwtSecret();
    } catch (error) {
      console.error(`Refusing to start: ${(error as Error).message}`);
      process.exit(1);
    }
  }
}
