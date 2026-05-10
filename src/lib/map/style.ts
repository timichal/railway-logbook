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
    default: '#2563eb',
    hover: '#dc2626',
    selected: '#16a34a',
  },
  railwayRoutes: {
    // Default fallback before visit-status colors are applied (admin map uses this).
    default: { branch: '#b8554f', main: '#b8554f', highspeed: '#7a3633' },
    // Admin selected route (orange).
    selected: '#ff6b35',
    visited: { branch: '#1f8a4c', main: '#1f8a4c', highspeed: '#155e34' },
    unvisited: { branch: '#b8554f', main: '#b8554f', highspeed: '#7a3633' },
    partial: { branch: '#d97706', main: '#d97706', highspeed: '#92400e' },
    invalid: '#9ca3af', // Grey for invalid routes
  },
  // Highlight overlays drawn on top of railway_routes.
  // 'planner' — Journey Planner pathfinder result (gold).
  // 'view'    — My Trips browsing; same orange as the admin selected-route style.
  highlight: {
    planner: '#FFD700',
    view: '#ff6b35',
  },
  // Amber outline drawn underneath scenic routes (separate layer).
  scenicOutline: '#fbbf24',
  // Bright preview line shown while creating/editing an admin route.
  preview: '#ff6600',
  stations: {
    fill: '#ff7800',
    stroke: '#000',
  },
  adminNotes: {
    fill: '#fbbf24',     // Yellow/amber for notes
    stroke: '#78350f',   // Dark brown stroke
    hover: '#f59e0b',    // Darker amber on hover
  },
  // Markers drawn on the admin map for picked coordinates and existing endpoints.
  adminMarkers: {
    start: '#16a34a',         // Green for start coordinate
    end: '#dc2626',           // Red for end coordinate
    routeEndpoint: '#3b82f6', // Blue dot for every existing route endpoint
    stroke: '#ffffff',
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
    z7: { branch: 2,   main: 2.5, highspeed: 3   },
  },
  adminRoute: { branch: 2.5, main: 3, highspeed: 3 },
  clickBuffer: {
    z4:  { branch: 14, main: 14, highspeed: 14 },
    z12: { branch: 16, main: 16, highspeed: 16 },
  },
  scenicOutline: {
    z4: { branch: 6.5, main: 6.6, highspeed: 6.8 },
    z7: { branch: 8,   main: 8.5, highspeed: 9   },
  },
  // Special-usage routes are slightly thinner than branch (multiplier on
  // the branch width at each stop).
  specialUsageMultiplier: 0.85,
  // Constant pixel width used for: admin map's selected route, user map's
  // Route Logger selection (selected_routes_highlight), and user map's
  // Journey Planner / My Trips highlight (highlighted_routes).
  selectedRoute: 5,
  // Bright preview line shown while creating/editing an admin route.
  preview: 8,
} as const;

// ============================================================================
// CIRCLES
// ============================================================================

/**
 * Radius + stroke width for every circle layer on the map.
 */
export const CIRCLES = {
  station:        { radius: 3, strokeWidth: 1 },
  adminNote:      { radius: 6, hoverRadius: 8, strokeWidth: 2 },
  // Picked start/end coordinate markers shown while creating/editing an admin route.
  pickedPoint:    { radius: 8, strokeWidth: 2 },
  // Blue dots marking every existing route endpoint on the admin map.
  routeEndpoint:  { radius: 5, strokeWidth: 1.5 },
} as const;

// ============================================================================
// OPACITIES
// ============================================================================

export const OPACITIES = {
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
