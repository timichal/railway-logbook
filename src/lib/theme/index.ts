"use client";

import { useSyncExternalStore } from "react";

/**
 * The colour scheme, as a preference and as a resolved answer.
 *
 * A **setting** rather than plain `prefers-color-scheme`, and a **localStorage**
 * setting rather than a `user_preferences` column: the shared map (`/shared/<token>`)
 * has to follow the *visitor's* choice and not the owner's, and an anonymous visitor
 * has no row to read. That also keeps it working before login, like the localStorage
 * journey log beside it.
 *
 * The class lives on `<html>` (see `THEME_INIT_SCRIPT`), which is what
 * `globals.css`'s `@custom-variant dark` and its `html.dark` palette key on.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "railway-logbook-theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Applied in `<head>` before the first paint, so a dark-mode visitor never sees a
 * white flash — the stylesheet needs the class to be there already, and React only
 * arrives after hydration. Duplicated logic rather than an import because it runs as
 * a raw string with no module system around it; it is small enough to keep honest.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=p==="dark"||((p===null||p==="system")&&window.matchMedia(${JSON.stringify(
  DARK_QUERY,
)}).matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;

function isPreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isPreference(stored)) return stored;
  } catch {
    // Private mode, or storage disabled. Fall through to the OS.
  }
  return "system";
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function apply(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  // Native form controls, scrollbars and the UA's own default backgrounds. Several
  // inputs in this app set no background of their own and rely on this.
  root.style.colorScheme = resolved;
}

const listeners = new Set<() => void>();

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Nothing to persist to; the class below still holds for this page.
  }
  apply(resolve(preference));
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  const media = window.matchMedia(DARK_QUERY);
  // Only matters while the preference is "system", but re-applying an explicit
  // choice is a no-op, so there is nothing to branch on.
  const onSystemChange = () => {
    apply(resolve(readThemePreference()));
    onStoreChange();
  };
  media.addEventListener("change", onSystemChange);
  // Another tab of the same app.
  window.addEventListener("storage", onSystemChange);
  return () => {
    listeners.delete(onStoreChange);
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onSystemChange);
  };
}

/**
 * The resolved scheme, read off the class the init script already set — so the
 * hydration render agrees with what is on screen instead of correcting it.
 *
 * `useSyncExternalStore` for the same reason as `useIsMobile`: the snapshot is read
 * during render. The server snapshot has to be something and "light" is the one
 * that matters least — everything that consumes this is inside a client-only
 * subtree (both maps are `ssr: false`; the switch lives in the menu sheet).
 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light" as ResolvedTheme,
  );
}

/** The stored choice, which is what the switch shows as pressed. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readThemePreference, () => "system" as ThemePreference);
}
