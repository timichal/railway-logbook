import { getUser, type User } from "./authActions";

/**
 * Ensure the current request comes from the admin user (user_id=1).
 * Throws "Admin access required" otherwise. Returns the admin User so callers
 * that need it can write `const user = await requireAdmin()`.
 *
 * Every admin server action must enforce this check (see CLAUDE.md).
 */
export async function requireAdmin(): Promise<User> {
  const user = await getUser();
  if (user?.id !== 1) {
    throw new Error("Admin access required");
  }
  return user;
}
