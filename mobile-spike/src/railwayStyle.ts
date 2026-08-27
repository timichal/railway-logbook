/**
 * The railway styling, ported from the web app's single source of truth.
 *
 * Copied rather than imported: the spike is a separate dependency tree (see
 * metro.config.js), and the point of Phase 0 is to find out whether these
 * expressions mean the same thing to MapLibre Native as they do to MapLibre GL
 * JS. If they do, the plan's "ports nearly verbatim" claim for `style.ts`,
 * `userMapLayers.ts` and `userRouteStyling.ts` is confirmed and Phase 3 is the
 * three weeks it is budgeted at rather than five.
 *
 * Sources: `src/lib/map/style.ts`, `src/lib/map/utils/userRouteStyling.ts`,
 * `src/lib/map/index.ts`, `src/lib/map/userMapLayers.ts`.
 *
 * The expression types come from `@maplibre/maplibre-gl-style-spec`, which is
 * the *same* package the web app's `maplibre-gl` types come from — the binding
 * depends on it directly and re-exports most of it. So these expressions are
 * checked against the identical spec on both sides, which is a good part of why
 * the port is as cheap as the plan claims.
 */

import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";

// ---------------------------------------------------------------------------
// COLORS — from COLORS.railwayRoutes / COLORS.stations in style.ts
// ---------------------------------------------------------------------------

export const COLORS = {
  railwayRoutes: {
    visited: { branch: "#1f8a4c", main: "#1f8a4c", highspeed: "#155e34" },
    unvisited: { branch: "#b8554f", main: "#b8554f", highspeed: "#7a3633" },
    partial: { branch: "#d97706", main: "#d97706", highspeed: "#92400e" },
  },
  scenicOutline: "#fbbf24",
  stations: {
    fill: "#ff7800",
    stroke: "#000",
    label: "#4957ad",
    labelHalo: "rgba(255, 255, 255, 0.6)",
  },
} as const;

// ---------------------------------------------------------------------------
// WIDTHS / DASHES / CIRCLES / LABELS / OPACITIES — from style.ts
// ---------------------------------------------------------------------------

export const WIDTHS = {
  userRoute: {
    z4: { branch: 0.5, main: 0.6, highspeed: 0.8 },
    z7: { branch: 2, main: 2.5, highspeed: 3 },
  },
  scenicOutline: {
    z4: { branch: 6.5, main: 6.6, highspeed: 6.8 },
    z7: { branch: 8, main: 8.5, highspeed: 9 },
  },
  specialUsageMultiplier: 1.2,
  heritageDotMultiplier: 1.8,
} as const;

export const DASHES = {
  special: [2.5, 2],
  heritage: [0, 3],
} as const;

export const CIRCLES = { station: { radius: 3, strokeWidth: 1 } } as const;

export const LABELS = {
  station: {
    minZoom: 11,
    size: { base: 13, large: 14 },
    largeZoom: 16,
    haloWidth: 1.5,
    offsetEm: 0.9,
    maxWidthEm: 8,
    lineHeight: 1.05,
  },
} as const;

export const OPACITIES = {
  basemapFade: 0.25,
  defaultRoute: 0.8,
  scenicOutline: 0.6,
  stations: 0.8,
} as const;

/** The one font OpenFreeMap's glyph endpoint serves in bold. See style.ts. */
export const BASEMAP_FONT_BOLD = "Noto Sans Bold";

// ---------------------------------------------------------------------------
// EXPRESSIONS — from userRouteStyling.ts and lineClassColorExpression()
// ---------------------------------------------------------------------------

type ClassColors = { branch: string; main: string; highspeed: string };
type WidthStop = { branch: number; main: number; highspeed: number };

/**
 * `lineClassColorExpression` from `src/lib/map/index.ts`.
 *
 * A `match`, not a chain of `==` cases: proven on the device to convert
 * cleanly, and one property read instead of three.
 */
function lineClassColorExpression(colors: ClassColors): ExpressionSpecification {
  return [
    "match",
    ["get", "line_class"],
    "highspeed",
    colors.highspeed,
    "branch",
    colors.branch,
    colors.main,
  ] as ExpressionSpecification;
}

/**
 * `getUserRouteColorExpression`, minus the two `feature-state` branches.
 *
 * Those exist for the web app's unauthenticated localStorage path, which has no
 * equivalent here — and `feature-state` support is itself something the native
 * SDK may or may not have, so leaving it out keeps the spike measuring one thing.
 * With no `user_id` on the tile, `date` is never present and every route falls
 * through to unvisited red; with `user_id=1` the green/orange branches light up,
 * which is how the spike checks the tile's per-user join actually arrives.
 *
 * **This is the shape the device forced, and the reason the spike was worth
 * running.** The original — a flat `case` whose first condition was
 * `["all", ["has", "date"], ["==", ["get", "has_complete_trip"], true]]` —
 * crashes the app on launch with `std::bad_alloc` thrown out of the binding's
 * `layer.lineColor = styleValue.mlnStyleValue`. The trigger is an `all`
 * condition in a `case` that has a further branch; an `all` alone is fine, and
 * two plain conditions are fine. Nesting says the same thing without any
 * conjunction, because reaching the inner `case` already means `has date` held.
 * The web app now carries this same shape (see `userRouteStyling.ts`).
 */
export function getUserRouteColorExpression(): ExpressionSpecification {
  return [
    "case",
    ["has", "date"],
    [
      "case",
      ["==", ["get", "has_complete_trip"], true],
      lineClassColorExpression(COLORS.railwayRoutes.visited),
      lineClassColorExpression(COLORS.railwayRoutes.partial),
    ],
    lineClassColorExpression(COLORS.railwayRoutes.unvisited),
  ] as ExpressionSpecification;
}

/** `widthByClass` from userRouteStyling.ts. */
function widthByClass(stop: WidthStop): ExpressionSpecification {
  return [
    "case",
    ["!=", ["get", "usage_type"], 0],
    stop.branch * WIDTHS.specialUsageMultiplier,
    ["==", ["get", "line_class"], "branch"],
    stop.branch,
    ["==", ["get", "line_class"], "highspeed"],
    stop.highspeed,
    stop.main,
  ] as ExpressionSpecification;
}

/** `getUserRouteWidthExpression`. One top-level zoom interpolate, as on the web. */
export function getUserRouteWidthExpression(): ExpressionSpecification {
  const s = WIDTHS.userRoute;
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    widthByClass(s.z4),
    7,
    widthByClass(s.z7),
  ] as ExpressionSpecification;
}

/** `getUserRouteHeritageWidthExpression`. */
export function getUserRouteHeritageWidthExpression(): ExpressionSpecification {
  const s = WIDTHS.userRoute;
  const dot = (stop: WidthStop) => stop.branch * WIDTHS.heritageDotMultiplier;
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    dot(s.z4),
    7,
    dot(s.z7),
  ] as ExpressionSpecification;
}

/** `getUserRouteScenicOutlineWidthExpression`. */
export function getUserRouteScenicOutlineWidthExpression(): ExpressionSpecification {
  const s = WIDTHS.scenicOutline;
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    widthByClass(s.z4),
    7,
    widthByClass(s.z7),
  ] as ExpressionSpecification;
}

/**
 * `REGULAR_ONLY_FILTER` from userMapLayers.ts.
 *
 * Typed as an `ExpressionSpecification` rather than the broader
 * `FilterSpecification`, because the scenic-outline layer nests it inside an
 * `["all", ...]` — and the legacy filter forms `FilterSpecification` also admits
 * (`["!has", x]` and friends) are not valid inside a modern expression. The web
 * app's own annotation is narrow for the same reason.
 */
export const REGULAR_ONLY_FILTER: ExpressionSpecification = [
  "==",
  ["get", "usage_type"],
  0,
];

/** Station label text-size step, from `createStationLabelsLayer`. */
export function stationLabelSizeExpression(): ExpressionSpecification {
  return [
    "step",
    ["zoom"],
    LABELS.station.size.base,
    LABELS.station.largeZoom,
    LABELS.station.size.large,
  ] as ExpressionSpecification;
}
