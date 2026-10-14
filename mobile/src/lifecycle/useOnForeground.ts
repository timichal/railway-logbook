/**
 * Run something when the app comes back to the foreground.
 *
 * A phone app is not closed and reopened the way a browser tab is reloaded: it is
 * left in the background for hours and brought back as it was, with every answer it
 * holds as old as the moment it was left. This is the hook for the things that have
 * to notice — reported with how long the app was away, so a caller can tell a glance
 * at a message from a day spent elsewhere.
 *
 * The callback is read through a ref, so the listener is registered once per mount.
 */
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

export function useOnForeground(callback: (awayMs: number) => void): void {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    let leftAt: number | null = AppState.currentState === "background" ? Date.now() : null;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        leftAt ??= Date.now();
      } else if (state === "active" && leftAt !== null) {
        latest.current(Date.now() - leftAt);
        leftAt = null;
      }
      // `inactive` alone is not leaving: on iOS it is the notification centre, the
      // control centre, a Face ID sheet or a call banner over the app, and each of
      // those would otherwise cost a round of requests.
    });
    return () => subscription.remove();
  }, []);
}
