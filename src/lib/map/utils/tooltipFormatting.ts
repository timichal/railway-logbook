import {
  getLineClassLabel,
  getUsageBadgeColors,
  type LineClass,
  type UsageType,
} from "@/lib/constants";
import { REGIONS, type RegionId, regionUsageLabel } from "@/lib/regions";

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
  "display: inline-block; white-space: nowrap; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;";

/**
 * The heading of a route's hover popup, shared by the user and admin maps so the
 * two never drift apart.
 *
 * Where the region names its lines (Japan), the name leads and the endpoints
 * follow underneath — the name is what identifies the route there, and the
 * endpoints only say which stretch of it this is. Everywhere else the endpoints
 * are the title, as they always were. An unnamed route in a naming region falls
 * back to the endpoints rather than showing a blank line.
 */
export function formatRouteTitle(
  /** Straight off an MVT feature, so every field is loosely typed. */
  properties: { [key: string]: unknown },
  regionId: RegionId,
): string {
  const endpoints = `${escapeHtml(properties.from_station)} ⟷ ${escapeHtml(properties.to_station)}`;
  const name = REGIONS[regionId].hasRouteNames ? properties.name : null;

  if (typeof name !== "string" || !name.trim()) {
    return `<h3 style="font-weight: 700; font-size: 1.05rem; margin-bottom: 6px; color: black;">${endpoints}</h3>`;
  }

  return (
    `<h3 style="font-weight: 700; font-size: 1.05rem; color: black;">${escapeHtml(name)}</h3>` +
    `<div style="margin-bottom: 6px; color: black;">${endpoints}</div>`
  );
}

/**
 * Format route metadata as color-coded badges for tooltips
 */
export function formatRouteMetadataBadges(
  properties: {
    usage_type: UsageType;
    scenic?: boolean;
    line_class?: LineClass;
    frequency?: string;
  },
  /** Usage types are labelled per region — Japan calls them JR / non-JR lines. */
  regionId: RegionId,
): string {
  let badges = "";

  // Line class badge
  if (properties.line_class && properties.line_class !== "branch") {
    const lineClassLabel = getLineClassLabel(properties.line_class);
    const isHighspeed = properties.line_class === "highspeed";
    const lcColor = isHighspeed ? "#ffffff" : "#1e40af";
    const lcBgColor = isHighspeed ? "#ef4444" : "#bfdbfe";
    badges += ` <span style="${BADGE_STYLE} background-color: ${lcBgColor}; color: ${lcColor};">${lineClassLabel}</span>`;
  }

  // Usage type badge (Regular=blue, Heritage=purple, Special=teal)
  const usageLabel = regionUsageLabel(regionId, properties.usage_type);
  const { color: usageColor, bgColor: usageBgColor } = getUsageBadgeColors(properties.usage_type);
  badges += `<span style="${BADGE_STYLE} background-color: ${usageBgColor}; color: ${usageColor};">${usageLabel}</span>`;

  // Scenic badge
  if (properties.scenic) {
    badges += ` <span style="${BADGE_STYLE} background-color: #fbbf24; color: #78350f;">Scenic</span>`;
  }

  // Frequency badges
  if (properties.frequency && properties.frequency !== "{}") {
    const frequencies = properties.frequency
      .slice(1, -1)
      .split(",")
      .map((f: string) => f.trim().replaceAll('"', ""));
    badges += frequencies
      .map(
        (freq: string) =>
          ` <span style="${BADGE_STYLE} background-color: #dcfce7; color: #166534; margin-right: 4px;">${escapeHtml(freq)}</span>`,
      )
      .join("");
    badges += `<br />`;
  }

  return badges;
}
