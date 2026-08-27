"use server";

/**
 * Auth for the web app: the cookie transport, and nothing else.
 *
 * The credential work lives in `authQueries.ts` and the JWT work in
 * `authTokens.ts`, because the mobile API needs both without a cookie in sight
 * (see MOBILE_APP_PLAN.md, Phase 1). What is left here is exactly the part that
 * is browser-specific — reading and writing `railway-auth`.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateUser, registerUser } from "./authQueries";
import { COOKIE_NAME, createToken, type User, verifyToken } from "./authTokens";

export type { User };

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, matching the token's own TTL

async function setSessionCookie(user: User): Promise<void> {
  const token = await createToken(user);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function getUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return verifyToken(token);
}

export async function login(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const user = await authenticateUser(email, password);
  await setSessionCookie(user);

  return { success: true, user };
}

export async function register(formData: FormData, localPreferences?: string[]) {
  const user = await registerUser(
    {
      name: formData.get("name") as string,
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      confirmPassword: formData.get("confirmPassword") as string,
    },
    localPreferences,
  );

  await setSessionCookie(user);

  return { success: true, user };
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  redirect("/");
}
