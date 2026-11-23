import { issueTokens, requireUser } from "@/lib/api/auth";
import { readJsonBody, requireString } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { signOutOtherSessions } from "@/lib/authQueries";
import { tokenClockNow } from "@/lib/authTokens";
import { enforcePasswordCheckRateLimit } from "@/lib/rateLimit";

/**
 * POST /api/v1/auth/sign-out-others — { password } → a fresh token pair for the
 * calling device.
 *
 * The app's "Sign out other devices", as the web menu's: every token and cookie of
 * the account issued before now is refused from here on (`signOutOtherSessions`),
 * the caller's own pair included, so the caller gets a pair issued after the
 * cutoff and replaces its own with it. A wrong password is a 400, not a 401 (a 401
 * would send the client into refresh-and-sign-out), as `DELETE /auth/me` has it.
 * The password check draws on the sign-in budget.
 */
export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    enforcePasswordCheckRateLimit(request.headers);

    const body = await readJsonBody(request);
    const password = requireString(body, "password");

    await signOutOtherSessions(user.id, password, tokenClockNow());
    return jsonResponse(await issueTokens(user));
  });
}
