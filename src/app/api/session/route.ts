import { cookies } from "next/headers";
import { COOKIE_NAME, createToken } from "@/lib/authTokens";
import { RENEW_AFTER_MS, SESSION_COOKIE_OPTIONS } from "@/lib/sessionCookie";
import { verifySession } from "@/lib/sessionQueries";

/**
 * Who the session cookie signs in now (`{ userId }`, null when no one), renewing
 * the cookie once it is a day old. A signed-in page asks as it loads and whenever
 * it comes back into view (`useSessionKeepAlive`), which is what makes the
 * session slide.
 *
 * A route handler, not a server action: setting a cookie in an action re-renders
 * the whole page, and an action would queue the page's own actions behind it
 * (Next runs a client's actions one at a time). Not a proxy either, which could
 * renew on every request but is not meant to reach the database — and a renewal
 * must, after the signature: the new token is issued now, so minting it from a
 * token that predates a password change would carry that token past the change.
 *
 * A database fault throws, a 500 the page ignores: it is not "signed out".
 */
export async function POST(): Promise<Response> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifySession(token) : null;

  if (session && Date.now() - session.claims.issuedAtMs > RENEW_AFTER_MS) {
    cookieStore.set(COOKIE_NAME, await createToken(session.user), SESSION_COOKIE_OPTIONS);
  }

  return Response.json(
    { userId: session?.user.id ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
