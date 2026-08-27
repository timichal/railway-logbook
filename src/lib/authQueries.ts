/**
 * Credential checking and account creation, taking plain arguments.
 *
 * Lifted out of `authActions.ts` for the reason `progressQueries.ts` explains:
 * a "use server" export is a client-callable endpoint, and these are called by
 * three transports now — the web form action, and the mobile API's login and
 * register handlers (see MOBILE_APP_PLAN.md, Phase 1). What differs between
 * them is only where the resulting token is put, so that part stays in the
 * caller and the credential work lives here.
 *
 * Rejections are thrown as `ValidationError`: the web forms render
 * `error.message` directly, and the route handlers turn them into a 400 (a 401
 * for bad credentials) while an unexpected exception stays a 500.
 */

import bcrypt from "bcryptjs";
import type { User } from "./authTokens";
import { query } from "./db";
import { ValidationError } from "./errors";

/** Bcrypt cost. Unchanged from the original inline value. */
const SALT_ROUNDS = 12;

export async function authenticateUser(email: string, password: string): Promise<User> {
  if (!email || !password) {
    throw new ValidationError("Email and password are required");
  }

  const result = await query("SELECT id, email, name, password FROM users WHERE email = $1", [
    email,
  ]);

  if (result.rows.length === 0) {
    throw new ValidationError("Invalid email or password");
  }

  const user = result.rows[0];

  const isValid = await bcrypt.compare(password, user.password || "");
  if (!isValid) {
    throw new ValidationError("Invalid email or password");
  }

  return { id: user.id, email: user.email, name: user.name };
}

export interface RegistrationInput {
  name?: string | null;
  email: string;
  password: string;
  confirmPassword: string;
}

export async function registerUser(
  input: RegistrationInput,
  /** Country filter migrated from a not-logged-in visitor's localStorage. */
  localPreferences?: string[],
): Promise<User> {
  const { name, email, password, confirmPassword } = input;

  if (!email || !password || !confirmPassword) {
    throw new ValidationError("All fields are required");
  }

  if (password !== confirmPassword) {
    throw new ValidationError("Passwords do not match");
  }

  if (password.length < 6) {
    throw new ValidationError("Password must be at least 6 characters");
  }

  const existingUser = await query("SELECT id FROM users WHERE email = $1", [email]);
  if (existingUser.rows.length > 0) {
    throw new ValidationError("User with this email already exists");
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await query(
    "INSERT INTO users (email, name, password) VALUES ($1, $2, $3) RETURNING id, email, name",
    [email, name || null, hashedPassword],
  );

  const user = result.rows[0];

  if (localPreferences && localPreferences.length > 0) {
    try {
      await query("INSERT INTO user_preferences (user_id, selected_countries) VALUES ($1, $2)", [
        user.id,
        localPreferences,
      ]);
    } catch (error) {
      console.error("Error migrating preferences:", error);
      // Non-fatal: the account exists, and the default filter is every country.
    }
  }

  return { id: user.id, email: user.email, name: user.name };
}
