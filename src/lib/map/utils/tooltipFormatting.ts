import {
  getLineClassLabel,
  getUsageBadgeColors,
  getUsageLabel,
  type LineClass,
  type UsageType,
} from "@/lib/constants";

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
 * Format route metadata as color-coded badges for tooltips
 */
export function formatRouteMetadataBadges(properties: {
  usage_type: UsageType;
  scenic?: boolean;
  line_class?: LineClass;
  frequency?: string;
}): string {
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
  const usageLabel = getUsageLabel(properties.usage_type);
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
