/**
 * The entry route, and the only screen that knows about both trees.
 *
 * It exists unguarded so there is always a route to fall back to: when signing out
 * removes the `(tabs)` group under the router's feet, this is where the router lands,
 * and it sends the visitor on. While the session is still being settled it renders
 * nothing — the splash screen is still up.
 */
import { Redirect } from "expo-router";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/AuthContext";

export default function Index(): ReactNode {
  const { status } = useAuth();

  if (status === "loading") return null;
  return <Redirect href={status === "signedIn" ? "/map" : "/login"} />;
}
