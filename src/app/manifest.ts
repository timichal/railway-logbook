import type { MetadataRoute } from "next";
import { THEME_COLORS } from "@/lib/theme/colors";

/**
 * The web app manifest — what turns the site into something a phone can install
 * onto its home screen and open in its own window, with no browser chrome.
 *
 * `display: "standalone"` is the point of it: without browser chrome the map gets
 * the whole screen, which is where the safe-area padding (`safe-area` in
 * globals.css) and the bottom sheet's `h-dvh` maths finally pay off.
 *
 * `theme_color` is the light navbar, because a manifest carries one colour and
 * cannot follow a setting. The colour scheme *is* a setting here, so the live
 * status-bar colour comes from the `<meta name="theme-color">` that
 * `THEME_INIT_SCRIPT` writes instead; this value is the one an installer reads
 * before the app has ever run, and the one a launcher shows behind the splash.
 *
 * See `generateAppIcons.ts` for why the maskable icon is framed differently from
 * the other two.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Railway Logbook",
    // Home screens truncate at roughly 12 characters.
    short_name: "Railway Log",
    description: "Log your rail journeys around Europe and Japan",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
