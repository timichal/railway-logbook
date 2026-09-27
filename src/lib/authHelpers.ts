import { type ActionResult, asActionResult } from "./actionResult";
import { getUser } from "./authActions";
import { ValidationError } from "./errors";

/**
 * The body of every admin server action: refuses anyone but the admin
 * (user_id=1), then runs `action`, returning its expected rejections as
 * `{ error }` rather than throwing them (see `actionResult.ts`). The check lives
 * inside the wrapper so an admin action cannot be written without it, and so a
 * session that expired mid-visit reads "Admin access required" instead of the
 * generic production error.
 *
 * Every admin server action must go through this (see CLAUDE.md).
 */
export async function asAdmin<T>(action: () => Promise<T>): Promise<ActionResult<T>> {
  return asActionResult(async () => {
    const user = await getUser();
    if (user?.id !== 1) {
      throw new ValidationError("Admin access required");
    }
    return action();
  });
}
