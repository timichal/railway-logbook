import { useEffect, useRef } from "react";

/** At most one check a minute, however often the tab is switched to and from. */
const MIN_CHECK_INTERVAL_MS = 60 * 1000;

/**
 * Keeps a signed-in page's session alive, and says when it is gone anyway.
 *
 * Asks `/api/session` as the page loads and whenever it comes back into view,
 * which renews the cookie while the app is in use. A tab left open for days is
 * the case that matters: it comes back into view before anything is clicked, so
 * a session that ended meanwhile (unused past its TTL, or a password changed
 * elsewhere) is reported up front through `onSignedOut`, rather than as the
 * first save failing. So is a cookie now signing in someone else (another tab
 * signed out and in again), since this page's saves would go to that account.
 * Reported once each time it goes; signing back in re-arms it. A failed check
 * (offline, a server fault) says nothing either way.
 */
export function useSessionKeepAlive(userId: number | null, onSignedOut: () => void): void {
  const onSignedOutRef = useRef(onSignedOut);
  onSignedOutRef.current = onSignedOut;

  useEffect(() => {
    if (userId === null) return;

    let lastCheck = 0;
    let signedIn = true;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheck < MIN_CHECK_INTERVAL_MS) return;
      lastCheck = now;

      fetch("/api/session", { method: "POST" })
        .then((response) => (response.ok ? response.json() : Promise.reject(response)))
        .then(
          (session: { userId: number | null }) => {
            const wasSignedIn = signedIn;
            signedIn = session.userId === userId;
            if (wasSignedIn && !signedIn) onSignedOutRef.current();
          },
          () => {},
        );
    };

    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [userId]);
}
