import type { ResolvedTheme } from "./types";

/**
 * The colour the browser paints its own chrome with — Android's status bar, and the
 * strip Safari fills above and below the page.
 *
 * These are `--color-surface` from `globals.css`, restated as literals, because
 * both places that need them are outside CSS's reach: the manifest is JSON read
 * before the app has ever run, and `THEME_INIT_SCRIPT` runs before the stylesheet
 * is guaranteed to have been parsed. Keep them in step with `--color-surface`; the
 * point of the value is that the chrome matches the navbar under it.
 *
 * Its own module, with no `"use client"`, so `app/manifest.ts` can read it without
 * pulling the theme hooks into the server graph.
 */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#14161a",
};
