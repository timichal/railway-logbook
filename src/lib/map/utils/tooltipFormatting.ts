import { formatDateOnly } from "@/lib/shared/getUntimezonedDateStr";
import {
  type RouteFeatureProperties,
  type RouteTitleProperties,
  routeBadges,
  routeLinkLabel,
  routeTitle,
} from "@/lib/shared/map/routeFeature";
import type { RegionId } from "@/lib/shared/regions";

/** Straight off an MVT feature, so every field is loosely typed. */
type FeatureProperties = { [key: string]: unknown };

/**
 * Escape a value for interpolation into popup HTML (MapLibre popups are built as
 * HTML strings and handed to `setHTML`, so nothing is escaped for us).
 *
 * This matters beyond admin-entered text: station names come straight from OSM,
 * i.e. from a third party who can edit them.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Escape a URL for an `href`, returning "" for anything that isn't http(s) so a
 * `javascript:` or `data:` link can't be smuggled in through a route link or a
 * note source.
 */
export function safeHref(value: unknown): string {
  if (!value) return "";
  const raw = String(value).trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  return escapeHtml(raw);
}

/**
 * Shared badge chrome. `white-space: nowrap` keeps a multi-word tag ("Winter
 * break") on one line — a badge broken across lines reads as two badges.
 */
const BADGE_STYLE =
  "white-space: nowrap; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; line-height: 1.35;";

/**
 * The badges live in a wrapping flex row, so the space between them is one `gap`
 * declaration instead of a leading space (or a `margin-right`) hand-added per
 * badge — which is how neighbouring badges ended up touching — and a badge that
 * wraps to a second line is spaced like the first.
 */
const BADGE_ROW_STYLE = "display: flex; flex-wrap: wrap; gap: 4px; align-items: center;";

/**
 * One block of the popup body below the badges (note, link, last journey). The
 * rows carry their spacing on top rather than on the bottom, so the popup has no
 * trailing gap whichever row happens to be last.
 */
const POPUP_ROW_STYLE = "margin-top: 6px; line-height: 1.4;";

/** The rule above the "most recent journey" line. */
const POPUP_DIVIDER =
  '<hr style="margin: 8px 0 0; border: none; border-top: 1px solid var(--color-gray-200);" />';

/**
 * The heading of a route's hover popup, shared by the user and admin maps so the
 * two never drift apart.
 *
 * Where the region names its lines (Japan), the name leads and the endpoints
 * follow underneath — the name is what identifies the route there, and the
 * endpoints only say which stretch of it this is. Everywhere else the endpoints
 * are the title, as they always were. An unnamed route in a naming region falls
 * back to the endpoints rather than showing a blank line. The other lines sharing
 * the route sit between the two, quieter.
 */
function formatRouteTitle(properties: FeatureProperties, regionId: RegionId): string {
  const { name, alsoOn, endpoints } = routeTitle(properties as RouteTitleProperties, regionId);
  const escapedEndpoints = escapeHtml(endpoints);

  // Margins are set inline on both branches: `.railway-popup h3` in globals.css
  // would otherwise space the user map's heading differently from the admin's.
  if (name === null) {
    return `<h3 style="font-weight: 700; font-size: 1.05rem; margin: 0 0 6px; color: var(--color-fg);">${escapedEndpoints}</h3>`;
  }

  return (
    `<h3 style="font-weight: 700; font-size: 1.05rem; margin: 0; color: var(--color-fg);">${escapeHtml(name)}</h3>` +
    (alsoOn
      ? `<div style="margin: 0; font-size: 0.85em; color: var(--color-gray-500);">${escapeHtml(alsoOn)}</div>`
      : "") +
    `<div style="margin: 0 0 6px; color: var(--color-fg);">${escapedEndpoints}</div>`
  );
}

/**
 * Format route metadata as color-coded badges for tooltips, as one wrapping row.
 *
 * Which badges and which colours is `routeBadges`' decision — shared with the
 * native app, which draws the same list as views. All that is left here is the
 * markup. Both schemes' colours go in through `light-dark()`, which follows the
 * `color-scheme` the theme sets on the root, so the popup needs no theme of its own
 * and one left open across a scheme change follows it. Each is preceded by the
 * light colour alone: a browser without `light-dark()` (Safari before 17.5) drops
 * the declaration, and the badge would otherwise lose its chip altogether.
 */
function formatRouteMetadataBadges(
  properties: RouteFeatureProperties,
  /** Usage types are labelled per region — Japan calls them JR / non-JR lines. */
  regionId: RegionId,
): string {
  const badges = routeBadges(properties, regionId).map(
    ({ label, color, bgColor, dark }) =>
      `<span style="${BADGE_STYLE} background-color: ${bgColor}; background-color: light-dark(${bgColor}, ${dark.bgColor}); color: ${color}; color: light-dark(${color}, ${dark.color});">${escapeHtml(label)}</span>`,
  );

  return `<div style="${BADGE_ROW_STYLE}">${badges.join("")}</div>`;
}

/** What a mouse is told about a popup link it can't reach before the popup moves. */
export const DOUBLE_CLICK_HINT = "double-click to open";

/**
 * A link out of a popup, opened in a new tab, or "" when `url` isn't http(s) (see
 * `safeHref`). `hint` follows it in grey.
 */
export function popupLink(url: unknown, label: string, hint?: string): string {
  const href = safeHref(url);
  if (!href) return "";
  const link = `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color: var(--color-link); text-decoration: underline;">${escapeHtml(label)}</a>`;
  if (!hint) return link;
  return `${link} <span style="color: var(--color-gray-500); font-size: 0.85em;">(${escapeHtml(hint)})</span>`;
}

/**
 * The body of a route popup: the user map's hover popup and touch sheet, and the
 * admin map's hover popup. Title, badge row, then one block per piece of body text
 * — each its own element rather than `<br />`-separated runs, so the note never
 * continues the badge line.
 *
 * `linkRow` is off in the touch sheet, which carries a button in its place;
 * `linkHint` says how a mouse opens it where the map supports that. The "most
 * recent" row appears only on a tile coloured by someone's rides — never the admin's.
 */
export function formatRouteBody(
  properties: FeatureProperties,
  regionId: RegionId,
  { linkRow, linkHint }: { linkRow: boolean; linkHint?: string },
): string {
  let body = formatRouteTitle(properties, regionId);
  body += formatRouteMetadataBadges(properties as unknown as RouteFeatureProperties, regionId);

  if (properties.description) {
    body += `<div style="${POPUP_ROW_STYLE}"><b>Note:</b> ${escapeHtml(properties.description)}</div>`;
  }
  const link = linkRow
    ? popupLink(properties.link, routeLinkLabel(properties.link_name), linkHint)
    : "";
  if (link) body += `<div style="${POPUP_ROW_STYLE}">${link}</div>`;

  // `date` and `journey_name` are populated together from the most-recent logged
  // journey (both NOT NULL in user_journeys), so either both are present or neither is.
  if (properties.date) {
    const dateStr = escapeHtml(formatDateOnly(String(properties.date)));
    body += POPUP_DIVIDER;
    body += `<div style="${POPUP_ROW_STYLE} color: var(--color-gray-700);">Most recent: ${dateStr} (${escapeHtml(properties.journey_name)})</div>`;
  }

  return body;
}

/** The body of a scenic line's popup on the admin map, headed as a route's is. */
export function formatScenicLineBody(properties: FeatureProperties): string {
  const status = properties.is_valid === false ? "Scenic line · invalid" : "Scenic line";
  return (
    `<h3 style="font-weight: 700; font-size: 1.05rem; margin: 0 0 6px; color: var(--color-fg);">${escapeHtml(properties.from_station)} ⟷ ${escapeHtml(properties.to_station)}</h3>` +
    `<div style="font-size: 0.85rem; color: var(--color-gray-700);">${status}</div>` +
    `<div style="${POPUP_ROW_STYLE} font-size: 0.75rem; color: var(--color-gray-500);">Click to select</div>`
  );
}

/** The body of a station popup, on either map. */
export function formatStationBody(properties: FeatureProperties): string {
  return (
    `<h3 class="font-bold text-base mb-1" style="color: var(--color-fg);">${escapeHtml(properties.name) || "Unknown station"}</h3>` +
    `<div class="text-xs text-gray-600">Station</div>`
  );
}
