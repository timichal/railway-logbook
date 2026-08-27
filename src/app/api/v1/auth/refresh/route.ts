import { issueTokens, userFromRefreshToken } from "@/lib/api/auth";
import { readJsonBody } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";

/**
 * POST /api/v1/auth/refresh — { refreshToken } → a fresh pair.
 *
 * The refresh token is replaced as well as the access token, so a client that
 * checks in occasionally never runs its refresh window down. The old one stays
 * valid until it expires (nothing is stored server-side to invalidate it), so a
 * lost response costs nothing but a retry.
 */
export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const body = await readJsonBody(request);
    const user = await userFromRefreshToken(body.refreshToken);

    return jsonResponse(await issueTokens(user));
  });
}
