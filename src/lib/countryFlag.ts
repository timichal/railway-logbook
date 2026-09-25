/**
 * A country code as its flag.
 *
 * Its own module, and **shared with the native app**, because `countryUtils.ts` — the
 * obvious home — imports `@rapideditor/country-coder` to resolve a coordinate to a
 * country, and a module the native app imports may not reach for a dependency the
 * native app does not have. This one needs nothing: a regional-indicator pair is the
 * flag, and both clients draw the same one beside the same country.
 */

/**
 * ISO 3166-1 alpha-2 to the flag emoji, via Unicode regional indicators
 * (`"CZ"` → `"🇨🇿"`).
 */
export function getCountryFlag(countryCode: string): string {
  return countryCode
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}
