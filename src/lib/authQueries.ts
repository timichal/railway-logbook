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
 * Rejections are thrown as `ValidationError`: the web actions return its message
 * as `{ error }`, and the route handlers turn them into a 400 (a 401 for bad
 * credentials) while an unexpected exception stays a 500.
 *
 * An email is stored as `lower(btrim(...))`, in SQL rather than in JS so the
 * folding is Postgres' own and always satisfies the CHECK on `users.email`:
 * "Foo@x " signs in to, and cannot re-register, "foo@x".
 */

import bcrypt from "bcryptjs";
import type { User } from "./authTokens";
import pool from "./db";
import { ValidationError } from "./errors";
import { ABSENT_USER_HASH, hashPassword } from "./passwordHash";
import { updateSelectedCountriesForUser } from "./preferencesQueries";
import { normalizeCountryCodes } from "./shared/constants";

/**
 * Whether `password` matches the stored hash. Always compared, and against a
 * well-formed hash either way, so that neither a missing row nor a row with no
 * password answers faster than a real one.
 */
async function passwordMatches(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  const isValid = await bcrypt.compare(password, stored || ABSENT_USER_HASH);
  return Boolean(stored) && isValid;
}

export async function authenticateUser(email: string, password: string): Promise<User> {
  if (!email?.trim() || !password) {
    throw new ValidationError("Email and password are required");
  }

  const result = await pool.query<User & { password: string | null }>(
    "SELECT id, email, name, password FROM users WHERE email = lower(btrim($1))",
    [email],
  );

  const user = result.rows[0];
  if (!(await passwordMatches(password, user?.password)) || !user) {
    throw new ValidationError("Invalid email or password");
  }

  return { id: user.id, email: user.email, name: user.name };
}

interface RegistrationInput {
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

  if (!email?.trim() || !password || !confirmPassword) {
    throw new ValidationError("All fields are required");
  }

  if (password !== confirmPassword) {
    throw new ValidationError("Passwords do not match");
  }

  if (password.length < 6) {
    throw new ValidationError("Password must be at least 6 characters");
  }

  const existingUser = await pool.query("SELECT id FROM users WHERE email = lower(btrim($1))", [
    email,
  ]);
  if (existingUser.rows.length > 0) {
    throw new ValidationError("User with this email already exists");
  }

  const hashedPassword = await hashPassword(password);

  // The check above saves a bcrypt on the common case; this catches the race it
  // leaves open (a double submit, two tabs), which would otherwise surface as a
  // unique violation and reach the form as an opaque failure.
  const result = await pool.query<User>(
    `INSERT INTO users (email, name, password) VALUES (lower(btrim($1)), $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, name`,
    [email, name || null, hashedPassword],
  );

  const user = result.rows[0];
  if (!user) {
    throw new ValidationError("User with this email already exists");
  }

  // Client-supplied, so normalized before the emptiness check: a junk list that
  // normalizes to nothing must leave the default filter, not store an empty one
  const countries = normalizeCountryCodes(localPreferences ?? []);
  if (countries.length > 0) {
    try {
      await updateSelectedCountriesForUser(user.id, countries);
    } catch (error) {
      console.error("Error migrating preferences:", error);
      // Non-fatal: the account exists, and the default filter is every country.
    }
  }

  return { id: user.id, email: user.email, name: user.name };
}

/**
 * Delete an account and everything it holds, once the password has been given
 * again — the deletion both app stores require (MOBILE_APP_PLAN.md, Phase 6),
 * offered on the web as well so it is not an app-only right.
 *
 * Everything the user owns references `users` with `ON DELETE CASCADE` (trips,
 * journeys, logged parts, preferences and with them the share token), so the one
 * `DELETE` takes it all in a single statement. Every token issued for the account
 * stops working at once, since a token naming an account that is gone is refused
 * (`sessionQueries.ts`).
 *
 * The admin (user 1) cannot be deleted this way: the id is reserved, and losing
 * it would leave the routes with no one to maintain them. `createAdmin --reset`
 * is how that account changes hands.
 *
 * A wrong password is a `ValidationError` like any other rejected value — not a
 * 401, which the native client reads as an expired token and answers by
 * refreshing and then signing out.
 */
export async function deleteAccount(userId: number, password: string): Promise<void> {
  if (!password) {
    throw new ValidationError("Password is required");
  }

  if (userId === 1) {
    throw new ValidationError("The admin account cannot be deleted");
  }

  const result = await pool.query<{ password: string | null }>(
    "SELECT password FROM users WHERE id = $1",
    [userId],
  );
  const stored = result.rows[0]?.password;
  if (!(await passwordMatches(password, stored))) {
    throw new ValidationError("Incorrect password");
  }

  // Only while the hash is still the one just checked: a password changed during
  // the bcrypt must not be overruled by the old one.
  const deleted = await pool.query("DELETE FROM users WHERE id = $1 AND password = $2", [
    userId,
    stored,
  ]);
  if (deleted.rowCount === 0) {
    throw new ValidationError("Incorrect password");
  }
}
