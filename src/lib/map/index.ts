import maplibregl from 'maplibre-gl';

// ============================================================================
// CONSTANTS
// ============================================================================

export const MAP_CENTER: [number, number] = [14.5, 49.2]; // Czech Republic/Austria border region
export const MAP_ZOOM = 7;
export const TILE_SERVER_PORT = 3001;
export const OSM_TILES_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Use /tiles/ path in production (proxied through nginx), direct port in development
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const getTileBaseUrl = () => {
  if (typeof window === 'undefined') {
    // Server-side rendering
    return IS_PRODUCTION ? 'https://localhost/tiles' : 'http://localhost:3001';
  }
  // Client-side
  return IS_PRODUCTION
    ? `${window.location.protocol}//${window.location.hostname}/tiles`
    : `${window.location.protocol}//${window.location.hostname}:${TILE_SERVER_PORT}`;
};
const TILE_BASE_URL = getTileBaseUrl();

// Europe bounds: [west, south, east, north]
export const EUROPE_BOUNDS: [[number, number], [number, number]] = [
  [-12, 35], // Southwest corner (Portugal/Spain)
  [40, 71],  // Northeast corner (Western Russia/Scandinavia)
];

export const ZOOM_RANGES = {
  railwayRoutes: { min: 4, max: 18 }, // Matches Martin configuration
  railwayParts: { min: 4, max: 18 }, // Matches Martin configuration
  stations: { min: 10, max: 18 }, // Matches Martin configuration
} as const;

export const COLORS = {
  railwayParts: {
    default: '#2563eb',
    hover: '#dc2626',
    selected: '#16a34a',
  },
  railwayRoutes: {
    default: '#dc2626',
    created: '#dc2626',
    selected: '#ff6b35',
    visited: 'DarkGreen',
    unvisited: 'Crimson',
    partial: '#d97706', // Dark orange/amber
    invalid: '#9ca3af', // Grey for invalid routes
  },
  stations: {
    fill: '#ff7800',
    stroke: '#000',
  },
  preview: '#ff6600',
} as const;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface RailwayRoutesSourceOptions {
  userId?: number;
  cacheBuster?: number;
  selectedCountries?: string[];
}

export interface RailwayRoutesPaintConfig {
  colorExpression?: maplibregl.ExpressionSpecification;
  widthExpression?: maplibregl.ExpressionSpecification;
  opacityExpression?: maplibregl.ExpressionSpecification;
  defaultColor?: string;
  defaultWidth?: number;
  defaultOpacity?: number;
  filter?: maplibregl.FilterSpecification | null;
}

// ============================================================================
// LAYER CONFIGURATION FACTORIES
// ============================================================================

export function createOSMBackgroundLayer(): maplibregl.RasterLayerSpecification {
  return {
    id: 'background',
    type: 'raster',
    source: 'osm',
    minzoom: 4,
    maxzoom: 19, // has to be higher than the map max zoom
    paint: {
      'raster-fade-duration': 0,
      'raster-opacity': 1,
    },
  };
}

export function createOSMBackgroundSource(): maplibregl.RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: [OSM_TILES_URL],
    tileSize: 256,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
}

export function createRailwayRoutesSource(
  options: RailwayRoutesSourceOptions = {}
): maplibregl.VectorSourceSpecification {
  const { userId, cacheBuster, selectedCountries } = options;
  const baseUrl = `${TILE_BASE_URL}/railway_routes_tile/{z}/{x}/{y}`;
  const params = new URLSearchParams();

  if (userId !== undefined) params.append('user_id', userId.toString());
  if (cacheBuster !== undefined) params.append('v', cacheBuster.toString());
  if (selectedCountries !== undefined) {
    params.append('selected_countries', JSON.stringify(selectedCountries));
  }

  const queryString = params.toString();
  const tilesUrl = queryString ? `${baseUrl}?${queryString}` : baseUrl;

  return {
    type: 'vector',
    tiles: [tilesUrl],
    minzoom: ZOOM_RANGES.railwayRoutes.min,
    maxzoom: ZOOM_RANGES.railwayRoutes.max,
  };
}

export function createRailwayRoutesLayer(
  config: RailwayRoutesPaintConfig = {}
): maplibregl.LineLayerSpecification {
  const {
    colorExpression,
    widthExpression,
    opacityExpression,
    defaultColor = COLORS.railwayRoutes.default,
    defaultWidth = 3,
    defaultOpacity = 0.8,
    filter,
  } = config;

  const layer: maplibregl.LineLayerSpecification = {
    id: 'railway_routes',
    type: 'line',
    source: 'railway_routes',
    'source-layer': 'railway_routes',
    minzoom: ZOOM_RANGES.railwayRoutes.min,
    layout: {
      visibility: 'visible',
    },
    paint: {
      'line-color': colorExpression || defaultColor,
      'line-width': widthExpression || defaultWidth,
      'line-opacity': opacityExpression || defaultOpacity,
    },
  };

  // Add filter if provided
  if (filter !== undefined) {
    layer.filter = filter as maplibregl.FilterSpecification;
  }

  return layer;
}

export function createStationsSource(): maplibregl.VectorSourceSpecification {
  return {
    type: 'vector',
    tiles: [`${TILE_BASE_URL}/stations_tile/{z}/{x}/{y}`],
    minzoom: ZOOM_RANGES.stations.min,
    maxzoom: ZOOM_RANGES.stations.max,
  };
}

export function createStationsLayer(): maplibregl.CircleLayerSpecification {
  return {
    id: 'stations',
    type: 'circle',
    source: 'stations',
    'source-layer': 'stations',
    minzoom: ZOOM_RANGES.stations.min,
    paint: {
      'circle-radius': 4,
      'circle-color': COLORS.stations.fill,
      'circle-stroke-color': COLORS.stations.stroke,
      'circle-stroke-width': 1,
      'circle-opacity': 0.8,
    },
  };
}

export function createRailwayPartsSource(): maplibregl.VectorSourceSpecification {
  return {
    type: 'vector',
    tiles: [`${TILE_BASE_URL}/railway_parts_tile/{z}/{x}/{y}`],
    minzoom: ZOOM_RANGES.railwayParts.min,
    maxzoom: ZOOM_RANGES.railwayParts.max,
  };
}

export function createRailwayPartsLayer(): maplibregl.LineLayerSpecification {
  return {
    id: 'railway_parts',
    type: 'line',
    source: 'railway_parts',
    'source-layer': 'railway_parts',
    minzoom: ZOOM_RANGES.railwayParts.min,
    layout: {
      visibility: 'visible',
    },
    paint: {
      'line-color': COLORS.railwayParts.default,
      'line-width': 3,
      'line-opacity': 0.7,
    },
  };
}

// ============================================================================
// POPUP UTILITIES
// ============================================================================

export function closeAllPopups(): void {
  const popups = document.getElementsByClassName('maplibregl-popup');
  if (popups.length) {
    Array.from(popups).forEach(popup => popup.remove());
  }
}

// ============================================================================
// MAP STATE PERSISTENCE
// ============================================================================

export { loadMapState, saveMapState, clearMapState, type MapState } from './mapState';
