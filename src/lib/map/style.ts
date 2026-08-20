/**
 * Single source of truth for map styling: colors, widths, opacities.
 *
 * Anywhere a paint expression needs a color/width/opacity, pull it from
 * here rather than hardcoding it locally. Width stops are organized by
 * the zoom level they apply at so the user-map / scenic-outline / click-
 * buffer expressions all stay in sync.
 */

// ============================================================================
// COLORS
// ============================================================================

export const COLORS = {
  railwayParts: {
    default: "#2563eb",
    hover: "#dc2626",
    selected: "#16a34a",
  },
  railwayRoutes: {
    // Default fallback before visit-status colors are applied (admin map uses this).
    default: { branch: "#b8554f", main: "#b8554f", highspeed: "#7a3633" },
    // Admin selected route (orange).
    selected: "#ff6b35",
    visited: { branch: "#1f8a4c", main: "#1f8a4c", highspeed: "#155e34" },
    unvisited: { branch: "#b8554f", main: "#b8554f", highspeed: "#7a3633" },
    partial: { branch: "#d97706", main: "#d97706", highspeed: "#92400e" },
    invalid: "#9ca3af", // Grey for invalid routes
    // Violet for invalid routes the admin flagged as under repair — the OSM
    // layout is only temporarily broken, so they are parked, not a worklist item.
    underRepair: "#8b5cf6",
  },
  // Highlight overlays drawn on top of railway_routes.
  // 'planner' — Journey Planner pathfinder result (gold).
  // 'view'    — My Trips browsing; same orange as the admin selected-route style.
  highlight: {
    planner: "#FFD700",
    view: "#ff6b35",
  },
  // Amber outline drawn underneath scenic routes (separate layer).
  scenicOutline: "#fbbf24",
  // Bright preview line shown while creating/editing an admin route.
  preview: "#ff6600",
  stations: {
    fill: "#ff7800",
    stroke: "#000",
    // Station names, lifted from openstreetmap-carto's own station styling
    // (style/stations.mss): `@station-color: #7981b0` with
    // `@station-text: darken(saturate(@station-color, 15%), 10%)`, which
    // evaluates to #4957ad. The halo is carto's `@standard-halo-fill`,
    // rgba(255,255,255,0.6) - a *translucent* white, which is what gives the
    // labels their faded look instead of the hard cutout a solid halo produces.
    label: "#4957ad",
    labelHalo: "rgba(255, 255, 255, 0.6)",
  },
  adminNotes: {
    fill: "#fbbf24", // Yellow/amber for notes
    stroke: "#78350f", // Dark brown stroke
    hover: "#f59e0b", // Darker amber on hover
  },
  // Markers drawn on the admin map for picked coordinates and existing endpoints.
  adminMarkers: {
    start: "#16a34a", // Green for start coordinate
    end: "#dc2626", // Red for end coordinate
    routeEndpoint: "#3b82f6", // Blue dot for every existing route endpoint
    stroke: "#ffffff",
  },
} as const;

// ============================================================================
// WIDTHS
// ============================================================================

export const WIDTHS = {
  // All line classes are visible at every zoom; widths just shrink when
  // zoomed out so the map stays readable.
  userRoute: {
    z4: { branch: 0.5, main: 0.6, highspeed: 0.8 },
    z7: { branch: 2, main: 2.5, highspeed: 3 },
  },
  adminRoute: { branch: 2.5, main: 3, highspeed: 3 },
  clickBuffer: {
    z4: { branch: 14, main: 14, highspeed: 14 },
    z12: { branch: 16, main: 16, highspeed: 16 },
  },
  scenicOutline: {
    z4: { branch: 6.5, main: 6.6, highspeed: 6.8 },
    z7: { branch: 8, main: 8.5, highspeed: 9 },
  },
  // Special-usage routes are slightly thinner than branch (multiplier on
  // the branch width at each stop).
  specialUsageMultiplier: 0.85,
  // Heritage routes are drawn as a dotted line whose dot diameter equals the
  // line width, so they're noticeably fatter than branch to read as clear round
  // dots rather than tiny dashes (multiplier on the branch width at each stop).
  heritageDotMultiplier: 1.8,
  // Constant pixel width used for: admin map's selected route, user map's
  // Route Logger selection (selected_routes_highlight), and user map's
  // Journey Planner / My Trips highlight (highlighted_routes).
  selectedRoute: 5,
  // Bright preview line shown while creating/editing an admin route.
  preview: 8,
} as const;

// ============================================================================
// DASHES
// ============================================================================

/**
 * Dash patterns (in line-width multiples). Non-regular routes are each drawn in
 * their own layer because MapLibre's line-dasharray is not data-driven — it
 * can't switch on a feature property like usage_type.
 * - `special` (usage_type=2): dashed.
 * - `heritage` (usage_type=1): dotted. A zero-length dash rendered with a round
 *   line-cap shows up as a dot; the gap is in line-width multiples. The layer
 *   MUST set `line-cap: "round"` or the zero-length dashes render as nothing.
 */
export const DASHES = {
  special: [2.5, 2] as [number, number],
  // Round dots, well separated so they read as dots (not short dashes). Gap is
  // in line-width multiples, so the bigger heritageDotMultiplier already widens
  // it; keep this large enough that dots stay distinct from `special` dashes.
  heritage: [0, 3] as [number, number],
} as const;

// ============================================================================
// CIRCLES
// ============================================================================

/**
 * Radius + stroke width for every circle layer on the map.
 */
export const CIRCLES = {
  station: { radius: 3, strokeWidth: 1 },
  adminNote: { radius: 6, hoverRadius: 8, strokeWidth: 2 },
  // Picked start/end coordinate markers shown while creating/editing an admin route.
  pickedPoint: { radius: 8, strokeWidth: 2 },
  // Blue dots marking every existing route endpoint on the admin map.
  routeEndpoint: { radius: 5, strokeWidth: 1.5 },
} as const;

// ============================================================================
// OPACITIES
// ============================================================================

// ============================================================================
// LABELS
// ============================================================================

/**
 * Station name labels.
 *
 * These are ours rather than the basemap's. The old raster basemap drew station
 * names itself, baked into the tile in the local script - which is how Japan came
 * out in kanji, and why the vector switch left the dots unlabelled. Drawing them
 * from our own `stations` tile means they match the dots exactly (same
 * `near_route` filter on the user map), sit above the basemap fade at full
 * contrast, and carry the Latin-preferring name `pruneData` already resolved.
 *
 * The styling reproduces openstreetmap-carto's, which is what the raster basemap
 * used to draw: bold, a muted blue, and softened by a translucent halo. Each
 * value below cites the carto rule it came from.
 */
export const LABELS = {
  // modified from carto defaults
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

// ============================================================================
// OPACITIES
// ============================================================================

export const OPACITIES = {
  // The whole basemap, washed out under the railway data (see createBasemapFadeLayer).
  basemapFade: 0.25,
  defaultRoute: 0.8,
  selectedRoute: 1.0,
  highlight: 1.0,
  preview: 1.0,
  scenicOutline: 0.6,
  railwayParts: 0.7,
  stations: 0.8,
  adminNotes: 0.9,
  routeEndpoint: 0.8,
} as const;
