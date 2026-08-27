import { issueTokens } from "@/lib/api/auth";
import { readJsonBody, requireString } from "@/lib/api/params";
import { ApiError, apiHandler, jsonResponse } from "@/lib/api/response";
import { authenticateUser } from "@/lib/authQueries";
import { ValidationError } from "@/lib/errors";

/** POST /api/v1/auth/login — { email, password } → the token pair. */
export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const body = await readJsonBody(request);
    const email = requireString(body, "email");
    const password = requireString(body, "password");

    try {
      const user = await authenticateUser(email, password);
      return jsonResponse(await issueTokens(user));
    } catch (error) {
      // Rejected credentials are a 401, not the 400 a validation message gets.
      // Anything else is left alone, so a database failure stays a 500.
      if (error instanceof ValidationError) {
        throw new ApiError(401, error.message);
      }
      throw error;
    }
  });
}
