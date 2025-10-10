/**
 * Map styling constants for railway visualization
 */

// Colors
export const COLORS = {
  // Railway Parts
  PARTS_DEFAULT: '#2563eb',      // Blue for railway parts
  PARTS_STARTING: '#16a34a',     // Green for starting part
  PARTS_ENDING: '#dc2626',       // Red for ending part
  PARTS_HOVER: '#dc2626',        // Red on hover

  // Railway Routes
  ROUTES_DEFAULT: '#dc2626',     // Red for routes
  ROUTES_SELECTED: '#ff6b35',    // Orange for selected route

  // Preview Route
  PREVIEW: '#ff6600',            // Orange for preview route
} as const;

// Line Weights
export const WEIGHTS = {
  PARTS_LOW_ZOOM: 2,
  PARTS_HIGH_ZOOM: 3,
  PARTS_SELECTED: 6,
  PARTS_HOVER: 4,

  ROUTES_DEFAULT: 3,
  ROUTES_SELECTED: 5,
  ROUTES_HOVER: 6,

  PREVIEW: 6,
} as const;

// Opacities
export const OPACITIES = {
  PARTS_DEFAULT: 0.7,
  PARTS_SELECTED: 1.0,

  ROUTES_DEFAULT: 0.8,
  ROUTES_SELECTED: 1.0,
  ROUTES_HOVER: 1.0,

  PREVIEW: 0.9,
} as const;

// Fill Opacities
export const FILL_OPACITIES = {
  PARTS_DEFAULT: 0.6,
  PARTS_SELECTED: 0.8,
  ROUTES: 0.7,
} as const;

// Zoom Levels
export const ZOOM = {
  PARTS_THRESHOLD: 12,    // Zoom level threshold for parts weight change
  ROUTE_MAX: 12,          // Max zoom when focusing on route
  PREVIEW_MAX: 14,        // Max zoom when focusing on preview
} as const;

// Map Configuration
export const MAP_CONFIG = {
  INITIAL_CENTER: [49.5, 15.0] as [number, number],
  INITIAL_ZOOM: 7,
  TILE_URL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  TILE_ATTRIBUTION: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
} as const;

// Fit Bounds Options
export const FIT_BOUNDS_OPTIONS = {
  ROUTE: {
    padding: [50, 50] as [number, number],
    maxZoom: ZOOM.ROUTE_MAX,
  },
  PREVIEW: {
    padding: [50, 50] as [number, number],
    maxZoom: ZOOM.PREVIEW_MAX,
  },
} as const;

// Timing
export const TIMING = {
  DEBOUNCE_VIEWPORT: 500,        // ms to debounce viewport changes
  INITIAL_DATA_LOAD: 100,        // ms delay before initial data load
  INITIAL_ROUTES_LOAD: 200,      // ms delay before initial routes load
} as const;

// Cache
export const CACHE = {
  MAX_FEATURES: 5000,             // Maximum cached features
  EVICTION_BATCH: 1000,           // Number of features to evict when limit reached
} as const;

// Preview
export const PREVIEW = {
  DASH_ARRAY: '8, 4',             // Dash pattern for preview route
} as const;
