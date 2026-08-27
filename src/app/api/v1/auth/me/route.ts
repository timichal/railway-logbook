import { requireUser } from "@/lib/api/auth";
import { apiHandler, jsonResponse } from "@/lib/api/response";

/** GET /api/v1/auth/me — who the bearer token belongs to. */
export async function GET(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const user = await requireUser(request);
    return jsonResponse({ user });
  });
}
