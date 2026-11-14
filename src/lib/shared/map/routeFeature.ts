import {
  type BadgeColors,
  getLineClassLabel,
  getUsageBadgeColors,
  type LineClass,
  type UsageType,
} from "../constants";
import { REGIONS, type RegionId, regionUsageLabel } from "../regions";
import { COLORS } from "./style";

/**
 * What a route *says*, separated from how either client draws it. The fields come
 * from the route tile (usage type, line class, closed) and from the route's row read
 * by id (the web's `RouteDetails`, the API's route metadata): the tile carries no text.
 *
 * The web app renders these as HTML spans in a MapLibre popup
 * (`utils/tooltipFormatting.ts`); the native app renders them as `<View>`s in a
 * bottom sheet. The decisions are the same in both — which badges a route earns,
 * what colour each one is, and whether the line's name or its endpoints lead the heading — and they are the
 * kind of decision that quietly diverges once it is written twice. So they live
 * here and the two renderers are left with nothing but markup.
 *
 * Dependency-free (`constants`, `regions`), because the native app imports it
 * directly. Nothing here escapes anything: HTML escaping is the HTML renderer's
 * business, and React Native has no such hazard.
 */

interface RouteBadge extends BadgeColors {
  label: string;
}

/**
 * The heading's half of a route feature, split out because a heading can be drawn
 * for a feature whose metadata was never read. Loosely typed: the web's popup
 * merges it from an MVT feature and the route details.
 */
export interface RouteTitleProperties {
  from_station?: unknown;
  to_station?: unknown;
  name?: unknown;
  /** The other lines the route is part of (see `parseTextArray`). */
  other_names?: unknown;
}

export interface RouteFeatureProperties extends RouteTitleProperties {
  usage_type: UsageType;
  line_class?: LineClass;
  /** The usage tags. */
  usage_tags?: string[];
  /** A closed route (railway_routes.closed), and when, where known (YYYY-MM-DD). */
  closed?: boolean;
  closed_on?: string | null;
}

/**
 * A route's heading.
 *
 * Where the region names its lines (Japan), the name leads and the endpoints follow
 * underneath — the name is what identifies the route there, and the endpoints only
 * say which stretch of it this is. Everywhere else the endpoints are the title. An
 * unnamed route in a naming region falls back to the endpoints rather than showing
 * a blank line, which is why `name` comes back null rather than empty.
 *
 * `alsoOn` names the other lines sharing the route ("Also Chuo Main Line"), for the
 * places that describe one route at length (the popup, the sheet); a row in a list
 * leaves it out. Null when there are none, and always with a null `name`.
 */
export function routeTitle(
  properties: RouteTitleProperties,
  regionId: RegionId,
): { name: string | null; alsoOn: string | null; endpoints: string } {
  const endpoints = `${properties.from_station} ⟷ ${properties.to_station}`;
  const named = REGIONS[regionId].hasRouteNames ? properties.name : null;
  const name = typeof named === "string" && named.trim() ? named : null;
  const otherNames = name ? parseTextArray(properties.other_names) : [];
  const alsoOn = otherNames.length > 0 ? `Also ${otherNames.join(", ")}` : null;
  return { name, alsoOn, endpoints };
}

/**
 * What a route's link is called: the name the admin gave it (the heritage
 * railway's, say), else "Website". Takes the raw tile property or API field.
 */
export function routeLinkLabel(linkName: unknown): string {
  return typeof linkName === "string" && linkName.trim() ? linkName.trim() : "Website";
}

/**
 * A route's text-array field (usage tags, other line names), with empty and
 * non-string elements dropped. Absent is empty.
 */
export function parseTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item !== "");
}

/** Line class is only worth a badge when it is not the unremarkable default. */
const LINE_CLASS_BADGE: Partial<Record<LineClass, BadgeColors>> = {
  highspeed: { ...COLORS.badges.highspeed, dark: COLORS.badgesDark.highspeed },
  main: { ...COLORS.badges.main, dark: COLORS.badgesDark.main },
};

const USAGE_TAG_BADGE: BadgeColors = {
  ...COLORS.badges.usageTag,
  dark: COLORS.badgesDark.usageTag,
};

const CLOSED_BADGE: BadgeColors = {
  ...COLORS.badges.closed,
  dark: COLORS.badgesDark.closed,
};

/**
 * A closed route's badge text: "Closed", with the month where known ("Closed
 * 12/2024"). The day is stored, but a month is what a reader wants of it.
 */
export function closedLabel(closedOn: unknown): string {
  const match = typeof closedOn === "string" ? /^(\d{4})-(\d{2})/.exec(closedOn) : null;
  return match ? `Closed ${match[2]}/${match[1]}` : "Closed";
}

/**
 * Every badge a route earns, in the order they are shown: closed (first, as it
 * says the rest no longer holds), line class (unless branch, the unremarkable
 * default), usage type, then one per usage tag. Usage types are labelled per
 * region — Japan calls them JR / non-JR lines.
 */
export function routeBadges(properties: RouteFeatureProperties, regionId: RegionId): RouteBadge[] {
  const badges: RouteBadge[] = [];

  if (properties.closed === true) {
    badges.push({ label: closedLabel(properties.closed_on), ...CLOSED_BADGE });
  }

  const lineClassColors = properties.line_class && LINE_CLASS_BADGE[properties.line_class];
  if (properties.line_class && lineClassColors) {
    badges.push({ label: getLineClassLabel(properties.line_class), ...lineClassColors });
  }

  badges.push({
    label: regionUsageLabel(regionId, properties.usage_type),
    ...getUsageBadgeColors(properties.usage_type),
  });

  for (const tag of parseTextArray(properties.usage_tags)) {
    badges.push({ label: tag, ...USAGE_TAG_BADGE });
  }

  return badges;
}
