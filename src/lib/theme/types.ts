/**
 * Shared by the client-only theme module and the server-read `THEME_COLORS`, which
 * is why the types sit in a module of their own rather than in `index.ts`.
 */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
