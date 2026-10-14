/**
 * Who is signed in, and the three ways that changes.
 *
 * The cold start is the interesting part. Tokens live in the keychain and outlive
 * the process, so the app opens not knowing whether they still work — hence a
 * `loading` state, and a `/auth/me` call to settle it. That call goes through the
 * ordinary client, so an expired access token is refreshed on the way and a cold
 * start after a month away lands on the map rather than on the login screen.
 *
 * **Only a refused refresh signs out.** A cold start with no connection — on a train,
 * which is what the app is for — cannot ask `/auth/me`, but the tokens are still in
 * the keychain and may well be good. So it opens signed in as the user the device
 * last saw (`saveUser`), and the session is checked again on the next request or the
 * next return to the foreground. Only with no user on the device (a pair saved by a
 * build that did not keep one) does it fall back to the login screen; the tokens
 * survive that, and the next launch with a connection is signed in again.
 *
 * A failed refresh mid-session arrives here through `onSignedOut` rather than as an
 * error at whichever screen made the call — the session ending is not that screen's
 * problem.
 *
 * **A return to the foreground** brings the session up to date: the token pair is
 * renewed if it is close to running out (the map's route tiles cannot refresh it
 * themselves), the user is re-read, and after a real absence — and only if that
 * re-read reached the server — the log version is bumped, so the map's colours, the
 * numbers and the logbook re-read whatever was logged elsewhere meanwhile (on the
 * web, say). Offline, everything stays as it was drawn.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type ApiUser, type AuthResponse, onSignedOut, refreshIfExpiring } from "@/api/client";
import * as api from "@/api/endpoints";
import { useOnForeground } from "@/lifecycle/useOnForeground";
import { bumpLogVersion } from "@/logbook/logVersion";
import { clearTokens, loadTokens, loadUser, saveTokens, saveUser } from "./tokenStore";

/** Renew the pair on a return to the foreground when it has less than this left. */
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;
/** Away at least this long, and everything drawn from the log is re-read on return. */
const STALE_AFTER_MS = 60 * 1000;

type Status = "loading" | "signedOut" | "signedIn";

interface AuthValue {
  status: Status;
  user: ApiUser | null;
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
  const [user, setUser] = useState<ApiUser | null>(null);

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
        void saveUser(current);
      } catch {
        // Either the pair is dead — refused, and the client has already cleared it —
        // or the server could not be asked. Only the first is a sign-out.
        const [stillHeld, known] = await Promise.all([loadTokens(), loadUser()]);
        if (cancelled) return;
        if (stillHeld && known) {
          setUser(known);
          setStatus("signedIn");
        } else {
          forgetSession();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [forgetSession]);

  const accept = useCallback(async (response: ApiUser, result: AuthResponse) => {
    await Promise.all([saveTokens(result, result.expiresIn), saveUser(response)]);
    // A new session draws its own colours: the route tile's URL does not say whose
    // they are (the bearer header does), so the cache buster has to move instead.
    bumpLogVersion();
    setUser(response);
    setStatus("signedIn");
  }, []);

  // Read when the re-read lands, which may be after a sign-out
  const signedIn = useRef(false);
  signedIn.current = status === "signedIn";

  useOnForeground((awayMs) => {
    if (!signedIn.current) return;
    void (async () => {
      await refreshIfExpiring(REFRESH_MARGIN_MS).catch(() => {
        // Unreachable: the next request tries again.
      });
      try {
        const current = await api.me();
        if (!signedIn.current) return;
        setUser(current);
        void saveUser(current);
      } catch {
        // Offline, or the session is over — and that one has already been handled
        // through `onSignedOut`. Either way nothing is re-read: a new tile URL with
        // no connection behind it would wipe the routes already drawn.
        return;
      }
      if (awayMs >= STALE_AFTER_MS) bumpLogVersion();
    })();
  });

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
