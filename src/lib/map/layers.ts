import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  FilterSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { getNoteTypeColor, noteTypeOptions } from "../constants";
import type { ResolvedTheme } from "../theme/types";
import { BASEMAP_FONT_BOLD } from "./basemap";
import { CIRCLES, COLORS, DASHES, LABELS, OPACITIES } from "./style";
import { ZOOM_RANGES } from "./tileSources";

/**
 * Every layer the two clients draw over the basemap, as MapLibre layer
 * specifications.
 *
 * **Shared with the native app** (`@shared/map/layers`), which is why the types
 * come from `@maplibre/maplibre-gl-style-spec` rather than from `maplibre-gl`:
 * it is the package both `maplibre-gl`'s types and the React Native binding's
 * `<Layer>` props come from, so one spec object typechecks against either
 * renderer. Nothing here may import anything that reaches the DOM — the web
 * app's own entry point is `index.ts`, which re-exports all of this.
 */

export interface RailwayRoutesPaintConfig {
  colorExpression?: ExpressionSpecification;
  widthExpression?: ExpressionSpecification;
  opacityExpression?: ExpressionSpecification;
  defaultWidth?: number;
  defaultOpacity?: number;
  filter?: FilterSpecification | null;
}

/**
 * Helper: returns a MapLibre expression that picks a color based on line_class
 *
 * A `match` rather than a chain of `["==", ["get", "line_class"], ...]` cases:
 * one property read instead of three, and it is a shape MapLibre Native's
 * binding converts without trouble. See "Route colours" in CLAUDE.md for why
 * that second point matters here.
 */
export function lineClassColorExpression(colors: {
  branch: string;
  main: string;
  highspeed: string;
}): ExpressionSpecification {
  return [
    "match",
    ["get", "line_class"],
    "highspeed",
    colors.highspeed,
    "main",
    colors.main,
    colors.branch,
  ] as ExpressionSpecification;
}

// ============================================================================
// LAYER CONFIGURATION FACTORIES
// ============================================================================

export function createRailwayRoutesLayer(
  config: RailwayRoutesPaintConfig = {},
): LineLayerSpecification {
  const {
    colorExpression,
    widthExpression,
    opacityExpression,
    defaultWidth = 3,
    defaultOpacity = OPACITIES.defaultRoute,
    filter,
  } = config;

  const layer: LineLayerSpecification = {
    id: "railway_routes",
    type: "line",
    source: "railway_routes",
    "source-layer": "railway_routes",
    minzoom: ZOOM_RANGES.railwayRoutes.min,
    layout: {
      visibility: "visible",
    },
    paint: {
      "line-color": colorExpression || lineClassColorExpression(COLORS.railwayRoutes.default),
      "line-width": widthExpression || defaultWidth,
      "line-opacity": opacityExpression || defaultOpacity,
    },
  };

  // Add filter if provided
  if (filter !== undefined) {
    layer.filter = filter as FilterSpecification;
  }

  return layer;
}

/**
 * Invisible wide line layer used as a click/hover hit area for routes.
 * Sits underneath the visible railway_routes layer; queryRenderedFeatures
 * picks it up so thin visible lines stay easy to tap on touch screens.
 *
 * The native app has no equivalent and needs none: a press is delivered by the
 * source's own `onPress` with a 44×44pt hitbox, which is the same affordance
 * without a layer to pay for.
 */
export function createRailwayRoutesClickLayer(
  config: RailwayRoutesPaintConfig = {},
): LineLayerSpecification {
  const { widthExpression, defaultWidth = 16, filter } = config;

  const layer: LineLayerSpecification = {
    id: "railway_routes_click",
    type: "line",
    source: "railway_routes",
    "source-layer": "railway_routes",
    minzoom: ZOOM_RANGES.railwayRoutes.min,
    layout: { visibility: "visible" },
    paint: {
      "line-color": "#000000",
      "line-width": widthExpression || defaultWidth,
      "line-opacity": 0,
    },
  };

  if (filter !== undefined) {
    layer.filter = filter as FilterSpecification;
  }

  return layer;
}

/**
 * Dashed line layer for Special routes (usage_type=2). Drawn as its own layer
 * because line-dasharray can't be data-driven, and because the solid base
 * railway_routes layer must NOT also draw these (a solid line under the dashes
 * would fill the gaps). Hidden by default; revealed by the "Show special services"
 * toggle (useLayerFilters). Shares the route source so feature-state visit
 * colors apply identically.
 */
export function createRailwayRoutesSpecialLayer(
  config: RailwayRoutesPaintConfig = {},
): LineLayerSpecification {
  const {
    colorExpression,
    widthExpression,
    opacityExpression,
    defaultWidth = 3,
    defaultOpacity = OPACITIES.defaultRoute,
  } = config;

  return {
    id: "railway_routes_special",
    type: "line",
    source: "railway_routes",
    "source-layer": "railway_routes",
    minzoom: ZOOM_RANGES.railwayRoutes.min,
    layout: {
      visibility: "none", // controlled by "Show special services" checkbox
    },
    paint: {
      "line-color": colorExpression || lineClassColorExpression(COLORS.railwayRoutes.default),
      "line-width": widthExpression || defaultWidth,
      "line-opacity": opacityExpression || defaultOpacity,
      "line-dasharray": [...DASHES.special],
    },
    filter: ["==", ["get", "usage_type"], 2] as FilterSpecification,
  };
}

/**
 * Dotted line layer for Heritage routes (usage_type=1). Like the Special layer,
 * it must be its own layer because line-dasharray can't be data-driven, and a
 * solid base railway_routes line underneath would fill the dot gaps. Drawn with
 * round line-caps so the zero-length dashes render as dots. Hidden by default on
 * the user map (revealed by the "Show heritage & tourist lines" toggle, useLayerFilters);
 * the admin map makes it visible. Shares the route source so feature-state visit
 * colors apply identically.
 */
export function createRailwayRoutesHeritageLayer(
  config: RailwayRoutesPaintConfig = {},
): LineLayerSpecification {
  const {
    colorExpression,
    widthExpression,
    opacityExpression,
    defaultWidth = 3,
    defaultOpacity = OPACITIES.defaultRoute,
  } = config;

  return {
    id: "railway_routes_heritage",
    type: "line",
    source: "railway_routes",
    "source-layer": "railway_routes",
    minzoom: ZOOM_RANGES.railwayRoutes.min,
    layout: {
      visibility: "none", // controlled by "Show heritage & tourist lines" checkbox (user map)
      "line-cap": "round", // makes the zero-length dashes render as dots
    },
    paint: {
      "line-color": colorExpression || lineClassColorExpression(COLORS.railwayRoutes.default),
      "line-width": widthExpression || defaultWidth,
      "line-opacity": opacityExpression || defaultOpacity,
      "line-dasharray": [...DASHES.heritage],
    },
    filter: ["==", ["get", "usage_type"], 1] as FilterSpecification,
  };
}

const SCENIC_OUTLINE_DEFAULT_OFFSET = 6; // px added to the visible width when no widthExpression is supplied

export function createScenicRoutesOutlineLayer(
  config: RailwayRoutesPaintConfig = {},
): LineLayerSpecification {
  const { widthExpression, defaultWidth = 3, filter } = config;

  // MapLibre forbids wrapping a zoom-interpolate inside another expression like
  // ['+', expr, 6], so the caller must supply a fully-formed width expression
  // (typically getUserRouteScenicOutlineWidthExpression).
  const outlineWidth: ExpressionSpecification | number =
    widthExpression ?? defaultWidth + SCENIC_OUTLINE_DEFAULT_OFFSET;

  const layer: LineLayerSpecification = {
    id: "railway_routes_scenic_outline",
    type: "line",
    source: "railway_routes",
    "source-layer": "railway_routes",
    minzoom: ZOOM_RANGES.railwayRoutes.min,
    layout: {
      visibility: "none", // Default to hidden, controlled by "Highlight scenic lines" checkbox
    },
    paint: {
      "line-color": COLORS.scenicOutline,
      "line-width": outlineWidth,
      "line-opacity": OPACITIES.scenicOutline,
    },
    filter: [
      "all",
      ["==", ["get", "scenic"], true],
      ...(filter ? [filter] : []),
    ] as FilterSpecification,
  };

  return layer;
}

/**
 * The dots and their names are the only two of our layers whose colours depend on
 * the basemap under them rather than on the data in them, so they are the only two
 * that take the scheme. Everything else (routes, notes, admin markers) is drawn in
 * a saturated colour that carries on either ground.
 */
function stationColors(theme: ResolvedTheme) {
  return theme === "dark" ? COLORS.stationsDark : COLORS.stations;
}

export function createStationsLayer(theme: ResolvedTheme = "light"): CircleLayerSpecification {
  const colors = stationColors(theme);
  return {
    id: "stations",
    type: "circle",
    source: "stations",
    "source-layer": "stations",
    minzoom: ZOOM_RANGES.stations.min,
    paint: {
      "circle-radius": CIRCLES.station.radius,
      "circle-color": colors.fill,
      "circle-stroke-color": colors.stroke,
      "circle-stroke-width": CIRCLES.station.strokeWidth,
      "circle-opacity": OPACITIES.stations,
    },
  };
}

/**
 * Station names, drawn from the same tile as the dots (see LABELS in style.ts).
 *
 * Styled after openstreetmap-carto's station labels - see LABELS.station in
 * style.ts for the carto rule each value comes from.
 */
export function createStationLabelsLayer(theme: ResolvedTheme = "light"): SymbolLayerSpecification {
  const colors = stationColors(theme);
  return {
    id: "station_labels",
    type: "symbol",
    source: "stations",
    "source-layer": "stations",
    minzoom: LABELS.station.minZoom,
    layout: {
      "text-field": ["get", "name"],
      // Carto's `@bold-fonts`, whose first entry is this. It must be the *only*
      // entry: MapLibre joins a text-font array with commas into one
      // `{fontstack}` path segment, so naming a fallback asks the glyph server
      // for "Noto Sans Bold,Noto Sans Regular" - a composite range OpenFreeMap
      // 404s, and a failed range means MapLibre draws the text with a local
      // system font instead. Which is exactly what a two-font stack here looked
      // like: not bold Noto at all.
      "text-font": [BASEMAP_FONT_BOLD],
      "text-size": [
        "step",
        ["zoom"],
        LABELS.station.size.base,
        LABELS.station.largeZoom,
        LABELS.station.size.large,
      ],
      "text-anchor": "top",
      "text-offset": [0, LABELS.station.offsetEm],
      "text-max-width": LABELS.station.maxWidthEm,
      "text-line-height": LABELS.station.lineHeight,
      // Drop labels that would collide rather than stacking them - a junction
      // complex has more station points than there is room for names.
      "text-allow-overlap": false,
      "text-padding": 2,
    },
    paint: {
      "text-color": colors.label,
      "text-halo-color": colors.labelHalo,
      "text-halo-width": LABELS.station.haloWidth,
    },
  };
}

export function createRailwayPartsLayer(): LineLayerSpecification {
  return {
    id: "railway_parts",
    type: "line",
    source: "railway_parts",
    "source-layer": "railway_parts",
    minzoom: ZOOM_RANGES.railwayParts.min,
    layout: {
      visibility: "visible",
    },
    paint: {
      "line-color": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        COLORS.railwayParts.hover,
        COLORS.railwayParts.default,
      ],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        4,
        0.8,
        7,
        ["case", ["boolean", ["feature-state", "hover"], false], 5, 3],
      ],
      "line-opacity": OPACITIES.railwayParts,
    },
  };
}

export function createAdminNotesLayer(): CircleLayerSpecification {
  // Color by note_type, derived straight from noteTypeOptions so the map can
  // never drift from the badge colors used in the sidebar.
  // The tuple assertion is what lets this spread into a `match` expression:
  // noteTypeOptions is a non-empty const tuple, so there is always at least one
  // label/color pair, but TS can't infer that through flatMap.
  const labelColorPairs = noteTypeOptions.flatMap((opt) => [opt.id, opt.color]) as [
    string,
    string,
    ...string[],
  ];

  const colorByType: ExpressionSpecification = [
    "match",
    ["get", "note_type"],
    ...labelColorPairs,
    COLORS.adminNotes.fill, // `match` requires a fallback; no note should reach it
  ];

  return {
    id: "admin_notes",
    type: "circle",
    source: "admin_notes",
    "source-layer": "admin_notes",
    minzoom: ZOOM_RANGES.adminNotes.min,
    paint: {
      "circle-radius": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        CIRCLES.adminNote.hoverRadius,
        CIRCLES.adminNote.radius,
      ],
      "circle-color": [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        COLORS.adminNotes.hover,
        colorByType,
      ],
      "circle-stroke-color": COLORS.adminNotes.stroke,
      "circle-stroke-width": CIRCLES.adminNote.strokeWidth,
      "circle-opacity": OPACITIES.adminNotes,
    },
  };
}

export function createPublicNotesLayer(): CircleLayerSpecification {
  return {
    id: "public_notes",
    type: "circle",
    source: "public_notes",
    "source-layer": "public_notes",
    minzoom: ZOOM_RANGES.publicNotes.min,
    paint: {
      "circle-radius": CIRCLES.adminNote.radius,
      // These are all note_type='Usage' by definition, so paint them the Usage color.
      "circle-color": getNoteTypeColor("Usage"),
      "circle-stroke-color": COLORS.adminNotes.stroke, // same dark stroke as the admin map
      "circle-stroke-width": CIRCLES.adminNote.strokeWidth,
      "circle-opacity": OPACITIES.adminNotes,
    },
  };
}
