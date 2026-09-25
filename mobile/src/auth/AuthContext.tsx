/**
 * Who is signed in, and the three ways that changes.
 *
 * The cold start is the interesting part. Tokens live in the keychain and outlive
 * the process, so the app opens not knowing whether they still work — hence a
 * `loading` state, and a `/auth/me` call to settle it. That call goes through the
 * ordinary client, so an expired access token is refreshed on the way and a cold
 * start after a month away lands on the map rather than on the login screen.
 *
 * A failed refresh mid-session arrives here through `onSignedOut` rather than as an
 * error at whichever screen made the call — the session ending is not that screen's
 * problem.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { onSignedOut } from "@/api/client";
import * as api from "@/api/endpoints";
import { clearTokens, loadTokens, saveTokens } from "./tokenStore";

type Status = "loading" | "signedOut" | "signedIn";

interface AuthValue {
  status: Status;
  user: api.ApiUser | null;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: {
    email: string;
    password: string;
    confirmPassword: string;
    name?: string;
  }): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<api.ApiUser | null>(null);

  const forgetSession = useCallback(() => {
    setUser(null);
    setStatus("signedOut");
  }, []);

  useEffect(() => {
    onSignedOut(forgetSession);
    return () => onSignedOut(null);
  }, [forgetSession]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const tokens = await loadTokens();
      if (!tokens) {
        if (!cancelled) forgetSession();
        return;
      }

      try {
        const current = await api.me();
        if (cancelled) return;
        setUser(current);
        setStatus("signedIn");
      } catch {
        // Either the pair is dead (the client has already cleared it) or the
        // network is down. Both mean "show the login screen"; the tokens survive a
        // network failure, so the next launch tries again.
        if (!cancelled) forgetSession();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [forgetSession]);

  const accept = useCallback(
    async (response: api.ApiUser, tokens: Parameters<typeof saveTokens>[0]) => {
      await saveTokens(tokens);
      setUser(response);
      setStatus("signedIn");
    },
    [],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await api.login(email.trim(), password);
      await accept(result.user, result);
    },
    [accept],
  );

  const signUp = useCallback(
    async (input: { email: string; password: string; confirmPassword: string; name?: string }) => {
      const result = await api.register({ ...input, email: input.email.trim() });
      await accept(result.user, result);
    },
    [accept],
  );

  const signOut = useCallback(async () => {
    // There is no logout endpoint: the tokens are stateless, so logging out *is*
    // dropping them (`API.md`).
    await clearTokens();
    forgetSession();
  }, [forgetSession]);

  return (
    <AuthContext.Provider value={{ status, user, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
