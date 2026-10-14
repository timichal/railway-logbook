/**
 * Run something when the signed-in session ends — a sign-out, or a refresh the
 * server refused.
 *
 * For state held **above the auth guard**: the providers that hold what the map and
 * the logging screens pick (the selection, the highlight, the planner) sit outside
 * it so both trees can reach them, which also means they outlive a sign-out. Whatever
 * they held belongs to whoever just left, and the next account to sign in must not
 * find it — the same reason the web drops its drafts on a change of user.
 *
 * On the transition only, so a provider mounting while the session is still being
 * settled is not cleared for nothing.
 */
import { useEffect, useRef } from "react";
import { useAuth } from "@/auth/AuthContext";

export function useOnSessionEnd(callback: () => void): void {
  const { status } = useAuth();
  const latest = useRef(callback);
  latest.current = callback;
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (status === "signedIn") {
      wasSignedIn.current = true;
    } else if (wasSignedIn.current) {
      wasSignedIn.current = false;
      latest.current();
    }
  }, [status]);
}
