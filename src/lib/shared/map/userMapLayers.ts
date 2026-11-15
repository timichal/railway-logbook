import type { FilterSpecification, LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { type UsageType, usageOptions } from "../constants";
import type { ResolvedTheme } from "../theme/types";
import type { LayerPrefs } from "./layerPrefs";
import {
  bothFilters,
  countryFilter,
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
import { NO_RIDES, type RouteRides } from "./routeRides";
import { OPACITIES } from "./style";
import {
  closedRouteOpacityExpression,
  getUserRouteClickBufferWidthExpression,
  getUserRouteColorExpression,
  getUserRouteHeritageWidthExpression,
  getUserRouteSortKeyExpression,
  getUserRouteWidthExpression,
} from "./utils/userRouteStyling";

/**
 * The user map's route layers, shared by the interactive map and the read-only
 * shared view (`/shared/<token>`), and by the native app.
 *
 * Both maps must draw the same lines in the same colours — a shared map that
 * styled its routes differently from the owner's own would be a bug that only
 * shows up once someone opens the link — so the configs are built here, from
 * nothing but the scheme and the rides (`routeRides.ts`).
 */

interface UserRouteLayerConfigs {
  /**
   * The solid Regular line. Each line's config is coloured and ordered by the rides,
   * and hides the closed routes not ridden (`closedRoutesFilter` with the switch
   * off), as the maps start out.
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

/**
 * `countries`: the country filter the web map starts out with, so a route outside
 * it never flashes before useLayerFilters takes over. Omitted by the native app,
 * whose tile is still filtered by country on the server.
 */
export function userRouteLayerConfigs(
  theme: ResolvedTheme,
  countries?: readonly string[],
  rides: RouteRides = NO_RIDES,
): UserRouteLayerConfigs {
  const colorExpression = getUserRouteColorExpression(theme, rides);
  const sortKeyExpression = getUserRouteSortKeyExpression(rides);
  const widthExpression = getUserRouteWidthExpression();
  const opacityExpression = closedRouteOpacityExpression(OPACITIES.defaultRoute);
  const routesFilter = userRoutesFilter({
    countries,
    showClosed: false,
    riddenClosed: rides.closed,
  });
  const line = { colorExpression, sortKeyExpression, opacityExpression, routesFilter };
  return {
    route: { ...line, widthExpression },
    special: { ...line, widthExpression },
    heritage: { ...line, widthExpression: getUserRouteHeritageWidthExpression() },
    // Regular only, as the lines start out; useLayerFilters widens it as the
    // switches reveal Heritage and Special
    clickBuffer: {
      widthExpression: getUserRouteClickBufferWidthExpression(),
      filter: bothFilters(clickBufferFilter([0]), routesFilter),
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
 * otherwise empty map.
 */
export function scenicLinesFilter(selectedCountries: readonly string[]): FilterSpecification {
  return countryFilter(selectedCountries);
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
 * otherwise only those the map's owner has ridden (`riddenClosed`, the closed ones
 * among `RouteRides`). Null — no filter — when all are shown.
 *
 * Done on the client because the tile is the same for everyone and carries no
 * rides. An `in` over a literal list is a linear search, but only the closed
 * routes reach it (`any` stops at the open ones), over the few closed routes
 * ridden.
 */
export function closedRoutesFilter(
  showClosed: boolean,
  riddenClosed: readonly number[] = [],
): FilterSpecification | null {
  if (showClosed) return null;
  if (riddenClosed.length === 0) return OPEN_ROUTES_FILTER;
  return [
    "any",
    OPEN_ROUTES_FILTER,
    ["in", ["id"], ["literal", [...riddenClosed]]],
  ] as FilterSpecification;
}

interface UserRoutesFilterOptions {
  /**
   * The countries the map is filtered to (`countryFilter`). Omitted, every country:
   * the native app's tile is still filtered on the server (`selected_countries`).
   */
  countries?: readonly string[];
  /** "All closed lines" (`closedRoutesFilter`). */
  showClosed: boolean;
  /** The closed routes the map's owner has ridden (`closedRoutesFilter`). */
  riddenClosed?: readonly number[];
}

/**
 * Which routes the user map draws, whatever their usage type: those in the selected
 * countries, and of the closed ones those `closedRoutesFilter` lets through. The
 * route lines and the click buffer narrow it further by usage type. Highlights
 * don't take it: a journey, trip or plan shows whole, as its partial stretches
 * (GeoJSON, never filtered by country) always did. Null when everything passes.
 */
export function userRoutesFilter({
  countries,
  showClosed,
  riddenClosed,
}: UserRoutesFilterOptions): FilterSpecification | null {
  return bothFilters(
    countries === undefined ? null : countryFilter(countries),
    closedRoutesFilter(showClosed, riddenClosed),
  );
}

/** The filter of one usage type's route line on the user map (`userRoutesFilter`). */
export function userRouteLineFilter(
  usageType: UsageType,
  options: UserRoutesFilterOptions,
): FilterSpecification {
  return routeLineFilter(usageType, userRoutesFilter(options));
}

/**
 * The full layer stack of the user map, bottom to top. The click-buffer layer is
 * included on the read-only map too: it carries the hover popups (routes are
 * thin, and hovering the visible line alone is finicky), and nothing but the
 * absence of a click handler makes that map read-only.
 */
export function createUserMapLayers(
  theme: ResolvedTheme = "light",
  countries?: readonly string[],
  /**
   * The map owner's rides as they stand when the map is built. Null while they
   * aren't known for an owner on the server, or were refused: the routes start
   * hidden, since drawn uncoloured they would pass for a map with nothing ridden.
   * useLayerFilters shows them once the rides arrive.
   */
  rides: RouteRides | null = NO_RIDES,
): LayerSpecification[] {
  const configs = userRouteLayerConfigs(theme, countries, rides ?? NO_RIDES);
  const shown = rides !== null;
  return [
    // Under everything: a band the route lines are drawn over. Hidden until the
    // "Scenic lines" toggle shows it (useLayerFilters).
    createScenicLinesLayer(),
    // Closed routes not ridden start out filtered away (in the configs), as "All
    // closed lines" starts off, and so do the countries not ticked; useLayerFilters
    // applies the switches once loaded
    createRouteLineLayer(0, { ...configs.route, visible: shown }),
    createRouteLineLayer(1, configs.heritage),
    createRouteLineLayer(2, configs.special),
    createRailwayRoutesClickLayer({ ...configs.clickBuffer, visible: shown }),
    createStationsLayer(theme),
    createStationLabelsLayer(theme),
    // Public Usage notes render on top (route tile refresh re-inserts route
    // layers before "stations", so this stays above them).
    createPublicNotesLayer(),
  ];
}
