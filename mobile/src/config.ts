/**
 * Build-time configuration.
 *
 * The web app derives its tile host from `window.location` (`getTileBaseUrl()` in
 * `src/lib/map/index.ts`). There is no `window` here, so both URLs are constants —
 * one module, because the API and the tiles are served by the same host and a
 * build that talks to one of them must talk to the other.
 *
 * The default is production over HTTPS, which is what a development build talks to:
 * both platforms block cleartext HTTP (iOS App Transport Security, Android since 9),
 * and pointing at a Mac's LAN address would mean an ATS exception plus an address
 * that changes with the network. `EXPO_PUBLIC_API_ORIGIN` overrides it — Expo inlines
 * `EXPO_PUBLIC_*` at bundle time — for whoever does want to run against a local
 * `next dev`.
 */
const DEFAULT_ORIGIN = "https://railmap.zlatkovsky.cz";

export const API_ORIGIN = (process.env.EXPO_PUBLIC_API_ORIGIN ?? DEFAULT_ORIGIN).replace(
  /\/+$/,
  "",
);

/** The versioned API root (`API.md`). */
export const API_BASE_URL = `${API_ORIGIN}/api/v1`;

/**
 * Martin, behind Caddy. The route tile coloured by the user's rides is not here but
 * on `API_ORIGIN` itself (`map/tileUrls.ts`).
 */
export const TILE_BASE_URL = `${API_ORIGIN}/tiles`;
