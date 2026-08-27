import { issueTokens } from "@/lib/api/auth";
import { optionalString, readJsonBody, requireString } from "@/lib/api/params";
import { apiHandler, jsonResponse } from "@/lib/api/response";
import { registerUser } from "@/lib/authQueries";

/**
 * POST /api/v1/auth/register — { email, password, confirmPassword, name? }.
 *
 * `registerUser` throws its validation messages, which `apiHandler` turns into
 * a 400; the app can show them as they are, exactly as the web form does.
 */
export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const body = await readJsonBody(request);

    const user = await registerUser({
      name: optionalString(body, "name"),
      email: requireString(body, "email"),
      password: requireString(body, "password"),
      confirmPassword: requireString(body, "confirmPassword"),
    });

    return jsonResponse(await issueTokens(user), 201);
  });
}
