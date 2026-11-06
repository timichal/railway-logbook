import type { FilterSpecification, LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { type UsageType, usageOptions } from "../constants";
import type { ResolvedTheme } from "../theme/types";
import type { LayerPrefs } from "./layerPrefs";
import {
  bothFilters,
  createPublicNotesLayer,
  createRailwayRoutesClickLayer,
  createRouteLineLayer,
  createScenicLinesLayer,
  createStationLabelsLayer,
  createStationsLayer,
  OPEN_ROUTES_FILTER,
  type RouteClickLayerConfig,
  type RouteLineConfig,
  routeLineFilter,
  usageTypeFilter,
} from "./layers";
import { OPACITIES } from "./style";
import {
  closedRouteOpacityExpression,
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

interface UserRouteLayerConfigs {
  /**
   * The solid Regular line. Each line's config hides the closed routes not ridden
   * (`closedRoutesFilter` with the switch off), as the maps start out.
   */
  route: RouteLineConfig;
  /**
   * Dashed Special / dotted Heritage: same visit-status colours as the solid line,
   * rendered dashed / dotted. Their usage_type filter and hidden-by-default
   * visibility are baked into the factory; useLayerFilters toggles visibility.
   */
  special: RouteLineConfig;
  heritage: RouteLineConfig;
  clickBuffer: RouteClickLayerConfig;
}

export function userRouteLayerConfigs(theme: ResolvedTheme): UserRouteLayerConfigs {
  const colorExpression = getUserRouteColorExpression(theme);
  const widthExpression = getUserRouteWidthExpression();
  const opacityExpression = closedRouteOpacityExpression(OPACITIES.defaultRoute);
  const routesFilter = closedRoutesFilter(false);
  return {
    route: { colorExpression, widthExpression, opacityExpression, routesFilter },
    special: { colorExpression, widthExpression, opacityExpression, routesFilter },
    heritage: {
      colorExpression,
      widthExpression: getUserRouteHeritageWidthExpression(),
      opacityExpression,
      routesFilter,
    },
    // Regular only, as the lines start out; useLayerFilters widens it as the
    // switches reveal Heritage and Special
    clickBuffer: {
      widthExpression: getUserRouteClickBufferWidthExpression(),
      filter: bothFilters(clickBufferFilter([0]), closedRoutesFilter(false)),
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
 * Which closed routes the user map draws: every one under "All closed lines",
 * otherwise only those the map's owner has ridden. Null — no filter — when all
 * are shown.
 *
 * Done on the client because the tile can't do it for every map: Martin's tile
 * (the anonymous map) carries no rides, whose rides are known only in the
 * browser. So a ride is read two ways, as the colour reads it: the tile's `date`
 * where the tile is coloured by someone's rides (the session, a share token, the
 * native app), and the anonymous visitor's ridden track ids (`localRiddenTrackIds`,
 * from the localStorage log) where it isn't. Feature state, which colours the
 * anonymous map, can't be read by a filter.
 */
export function closedRoutesFilter(
  showClosed: boolean,
  localRiddenTrackIds: readonly number[] = [],
): FilterSpecification | null {
  if (showClosed) return null;
  const shown: FilterSpecification[] = [OPEN_ROUTES_FILTER, ["has", "date"]];
  if (localRiddenTrackIds.length > 0) {
    shown.push(["in", ["id"], ["literal", [...localRiddenTrackIds]]]);
  }
  return ["any", ...shown] as FilterSpecification;
}

/**
 * The filter of one usage type's route line on the user map: that type, and the
 * closed routes `closedRoutesFilter` lets through.
 */
export function userRouteLineFilter(
  usageType: UsageType,
  showClosed: boolean,
  localRiddenTrackIds?: readonly number[],
): FilterSpecification {
  return routeLineFilter(usageType, closedRoutesFilter(showClosed, localRiddenTrackIds));
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
    // Closed routes not ridden start out filtered away (in the configs), as "All
    // closed lines" starts off; useLayerFilters applies the switch once loaded
    createRouteLineLayer(0, configs.route),
    createRouteLineLayer(1, configs.heritage),
    createRouteLineLayer(2, configs.special),
    createRailwayRoutesClickLayer(configs.clickBuffer),
    createStationsLayer(theme),
    createStationLabelsLayer(theme),
    // Public Usage notes render on top (route tile refresh re-inserts route
    // layers before "stations", so this stays above them).
    createPublicNotesLayer(),
  ];
}
