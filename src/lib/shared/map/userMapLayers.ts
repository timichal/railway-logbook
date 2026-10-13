import type { FilterSpecification, LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { type UsageType, usageOptions } from "../constants";
import type { ResolvedTheme } from "../theme/types";
import type { LayerPrefs } from "./layerPrefs";
import {
  createPublicNotesLayer,
  createRailwayRoutesClickLayer,
  createRailwayRoutesHeritageLayer,
  createRailwayRoutesLayer,
  createRailwayRoutesSpecialLayer,
  createScenicLinesLayer,
  createStationLabelsLayer,
  createStationsLayer,
  type RailwayRoutesPaintConfig,
  usageTypeFilter,
} from "./layers";
import {
  getUserRouteClickBufferWidthExpression,
  getUserRouteColorExpression,
  getUserRouteHeritageWidthExpression,
  getUserRouteWidthExpression,
} from "./utils/userRouteStyling";

/**
 * The user map's route layers, shared by the interactive map and the read-only
 * shared view (`/shared/<token>`), and by the native app.
 *
 * Both maps must draw the same lines in the same colours — a shared map that
 * styled its routes differently from the owner's own would be a bug that only
 * shows up once someone opens the link — so the configs are built here, from
 * nothing but the scheme.
 */

// Default to Regular-only (usage_type=0); the "Show heritage lines" and "Show
// special services" toggles (useLayerFilters) reveal Heritage / Special.
export const REGULAR_ONLY_FILTER: ["==", ["get", string], number] = [
  "==",
  ["get", "usage_type"],
  0,
];

interface UserRouteLayerConfigs {
  /** The solid Regular line. */
  route: RailwayRoutesPaintConfig;
  /**
   * Dashed Special / dotted Heritage: same visit-status colours as the solid line,
   * rendered dashed / dotted. Their usage_type filter and hidden-by-default
   * visibility are baked into the factories; useLayerFilters toggles visibility.
   */
  special: RailwayRoutesPaintConfig;
  heritage: RailwayRoutesPaintConfig;
  clickBuffer: RailwayRoutesPaintConfig;
}

export function userRouteLayerConfigs(theme: ResolvedTheme): UserRouteLayerConfigs {
  const colorExpression = getUserRouteColorExpression(theme);
  const widthExpression = getUserRouteWidthExpression();
  return {
    route: { colorExpression, widthExpression, filter: REGULAR_ONLY_FILTER },
    special: { colorExpression, widthExpression },
    heritage: { colorExpression, widthExpression: getUserRouteHeritageWidthExpression() },
    clickBuffer: {
      widthExpression: getUserRouteClickBufferWidthExpression(),
      filter: REGULAR_ONLY_FILTER,
    },
  };
}

/**
 * What the three layer toggles do to the filters, as expressions.
 *
 * Which usage types the two clients draw is one decision with two very different
 * implementations — the web app calls `setFilter` on a live map (`useLayerFilters`),
 * the native app passes a `filter` prop to a `<Layer>` — so the *filters* live here
 * rather than in either of them. Visibility is not: "hidden" is a layout property on
 * the web and an absent child on native, and there is nothing to share in that.
 */

/**
 * The usage types the user map draws under the usage switches, for what has to
 * follow them: the ridden stretches, a searched line's highlight, the progress box.
 * Regular is always among them except where the region lets it be switched off
 * (`LayerPrefs.showRegular` — Japan's JR lines).
 */
export function shownUsageTypes({
  showRegular,
  showHeritage,
  showSpecial,
}: Pick<LayerPrefs, "showRegular" | "showHeritage" | "showSpecial">): UsageType[] {
  const shown: UsageType[] = [];
  if (showRegular) shown.push(0);
  if (showHeritage) shown.push(1);
  if (showSpecial) shown.push(2);
  return shown;
}

/**
 * Scenic lines follow the country filter as the routes do — both ends in a selected
 * country — so a filtered-out country is not left with highlighted stretches on an
 * otherwise empty map. Applied as a layer filter rather than in the tile query, so
 * a country toggle needs no tile refresh for it.
 */
export function scenicLinesFilter(selectedCountries: string[]): FilterSpecification {
  return [
    "all",
    ["in", ["get", "start_country"], ["literal", selectedCountries]],
    ["in", ["get", "end_country"], ["literal", selectedCountries]],
  ];
}

/**
 * Every currently-visible usage type stays clickable. Returns null — no filter at
 * all — once all three are shown, so the common case costs no per-feature test.
 *
 * Web-only in effect: the native app has no click-buffer layer, because a press
 * arrives through the source's own 44×44pt hitbox instead.
 */
export function clickBufferFilter(clickable: readonly UsageType[]): FilterSpecification | null {
  return clickable.length === usageOptions.length ? null : usageTypeFilter(clickable);
}

/**
 * The full layer stack of the user map, bottom to top. The click-buffer layer is
 * included on the read-only map too: it carries the hover popups (routes are
 * thin, and hovering the visible line alone is finicky), and nothing but the
 * absence of a click handler makes that map read-only.
 */
export function createUserMapLayers(theme: ResolvedTheme = "light"): LayerSpecification[] {
  const configs = userRouteLayerConfigs(theme);
  return [
    // Under everything: a band the route lines are drawn over. Hidden until the
    // "Scenic lines" toggle shows it (useLayerFilters).
    createScenicLinesLayer(),
    createRailwayRoutesLayer(configs.route),
    createRailwayRoutesHeritageLayer(configs.heritage),
    createRailwayRoutesSpecialLayer(configs.special),
    createRailwayRoutesClickLayer(configs.clickBuffer),
    createStationsLayer(theme),
    createStationLabelsLayer(theme),
    // Public Usage notes render on top (route tile refresh re-inserts route
    // layers before "stations", so this stays above them).
    createPublicNotesLayer(),
  ];
}
