import { requireUser } from "@/lib/api/auth";
import { readJsonBody, requireString } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { deleteAccount } from "@/lib/authQueries";
import { enforcePasswordCheckRateLimit } from "@/lib/rateLimit";

/** GET /api/v1/auth/me — who the bearer token belongs to. */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    return jsonResponse({ user });
  });
}

/**
 * DELETE /api/v1/auth/me — { password } → the account and everything in it gone.
 *
 * A wrong password is a 400, not a 401: the client answers a 401 by refreshing and
 * then signing out, which is not what a mistyped password deserves.
 */
export async function DELETE(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    enforcePasswordCheckRateLimit(request.headers);

    const body = await readJsonBody(request);
    const password = requireString(body, "password");

    await deleteAccount(user.id, password);
    return jsonResponse({ success: true });
  });
}
