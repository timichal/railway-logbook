import {
  getLineClassLabel,
  getUsageBadgeColors,
  type LineClass,
  type UsageType,
} from "../constants";
import { REGIONS, type RegionId, regionUsageLabel } from "../regions";

/**
 * What a route's tile feature *says*, separated from how either client draws it.
 *
 * The web app renders these as HTML spans in a MapLibre popup
 * (`utils/tooltipFormatting.ts`); the native app renders them as `<View>`s in a
 * bottom sheet. The decisions are the same in both — which badges a route earns,
 * what colour each one is, how a Postgres `TEXT[]` of frequency tags comes apart,
 * and whether the line's name or its endpoints lead the heading — and they are the
 * kind of decision that quietly diverges once it is written twice. So they live
 * here and the two renderers are left with nothing but markup.
 *
 * Dependency-free (`constants`, `regions`), because the native app imports it
 * directly. Nothing here escapes anything: HTML escaping is the HTML renderer's
 * business, and React Native has no such hazard.
 */

export interface RouteBadge {
  label: string;
  /** Text colour. */
  color: string;
  /** Badge background. */
  bgColor: string;
}

/**
 * The heading's half of a route feature, split out because a heading can be drawn
 * for a feature whose metadata was never read — and both come straight off an MVT
 * feature, so every field is loosely typed.
 */
export interface RouteTitleProperties {
  from_station?: unknown;
  to_station?: unknown;
  name?: unknown;
}

export interface RouteFeatureProperties extends RouteTitleProperties {
  usage_type: UsageType;
  scenic?: boolean;
  line_class?: LineClass;
  /** A Postgres `TEXT[]` as the tile serialises it: `{Daily,"Winter break"}`. */
  frequency?: string;
}

/**
 * A route's heading.
 *
 * Where the region names its lines (Japan), the name leads and the endpoints follow
 * underneath — the name is what identifies the route there, and the endpoints only
 * say which stretch of it this is. Everywhere else the endpoints are the title. An
 * unnamed route in a naming region falls back to the endpoints rather than showing
 * a blank line, which is why `name` comes back null rather than empty.
 */
export function routeTitle(
  properties: RouteTitleProperties,
  regionId: RegionId,
): { name: string | null; endpoints: string } {
  const endpoints = `${properties.from_station} ⟷ ${properties.to_station}`;
  const named = REGIONS[regionId].hasRouteNames ? properties.name : null;
  const name = typeof named === "string" && named.trim() ? named : null;
  return { name, endpoints };
}

/**
 * A Postgres `TEXT[]` as the tile serialises it — `{}` for empty, otherwise
 * `{Daily,"Winter break"}`. Quoting is only ever a plain pair around a value
 * containing a space, which is all a frequency tag can carry.
 */
export function parseFrequencyTags(value: string | undefined): string[] {
  if (!value || value === "{}") return [];
  return value
    .slice(1, -1)
    .split(",")
    .map((tag) => tag.trim().replaceAll('"', ""))
    .filter(Boolean);
}

/** Line class is only worth a badge when it is not the unremarkable default. */
const LINE_CLASS_BADGE: Partial<Record<LineClass, Omit<RouteBadge, "label">>> = {
  highspeed: { color: "#ffffff", bgColor: "#ef4444" },
  main: { color: "#1e40af", bgColor: "#bfdbfe" },
};

const SCENIC_BADGE = { color: "#78350f", bgColor: "#fbbf24" };
const FREQUENCY_BADGE = { color: "#166534", bgColor: "#dcfce7" };

/**
 * Every badge a route earns, in the order they are shown: line class (unless
 * branch, the unremarkable default), usage type, scenic, then one per frequency
 * tag. Usage types are labelled per region — Japan calls them JR / non-JR lines.
 */
export function routeBadges(properties: RouteFeatureProperties, regionId: RegionId): RouteBadge[] {
  const badges: RouteBadge[] = [];

  const lineClassColors = properties.line_class && LINE_CLASS_BADGE[properties.line_class];
  if (properties.line_class && lineClassColors) {
    badges.push({ label: getLineClassLabel(properties.line_class), ...lineClassColors });
  }

  badges.push({
    label: regionUsageLabel(regionId, properties.usage_type),
    ...getUsageBadgeColors(properties.usage_type),
  });

  if (properties.scenic) badges.push({ label: "Scenic", ...SCENIC_BADGE });

  for (const tag of parseFrequencyTags(properties.frequency)) {
    badges.push({ label: tag, ...FREQUENCY_BADGE });
  }

  return badges;
}
