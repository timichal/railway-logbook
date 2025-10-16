import maplibregl from 'maplibre-gl';

// ============================================================================
// CONSTANTS
// ============================================================================

export const MAP_CENTER: [number, number] = [14.5, 49.2]; // Czech Republic/Austria border region
export const MAP_ZOOM = 7;
export const TILE_SERVER_PORT = 3001;
export const OSM_TILES_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const ZOOM_RANGES = {
  railwayRoutes: { min: 7, max: 14 },
  railwayParts: { min: 0, max: 14 },
  stations: { min: 10, max: 14 },
} as const;

export const COLORS = {
  railwayParts: {
    default: '#2563eb',
    hover: '#dc2626',
    selected: '#16a34a',
  },
  railwayRoutes: {
    default: '#dc2626',
    selected: '#ff6b35',
    visited: 'DarkGreen',
    unvisited: 'Crimson',
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
}

export interface RailwayRoutesPaintConfig {
  colorExpression?: unknown[];
  widthExpression?: unknown[];
  opacityExpression?: unknown[];
  defaultColor?: string;
  defaultWidth?: number;
  defaultOpacity?: number;
}

// ============================================================================
// LAYER CONFIGURATION FACTORIES
// ============================================================================

export function createOSMBackgroundLayer(): maplibregl.RasterLayerSpecification {
  return {
    id: 'background',
    type: 'raster',
    source: 'osm',
    minzoom: 0,
    maxzoom: 22,
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
  const { userId, cacheBuster } = options;
  const baseUrl = `${window.location.protocol}//${window.location.hostname}:${TILE_SERVER_PORT}/railway_routes_tile/{z}/{x}/{y}`;
  const params = new URLSearchParams();

  if (userId !== undefined) params.append('user_id', userId.toString());
  if (cacheBuster !== undefined) params.append('v', cacheBuster.toString());

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
  } = config;

  return {
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
  } as maplibregl.LineLayerSpecification;
}

export function createStationsSource(): maplibregl.VectorSourceSpecification {
  return {
    type: 'vector',
    tiles: [`${window.location.protocol}//${window.location.hostname}:${TILE_SERVER_PORT}/stations_tile/{z}/{x}/{y}`],
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
    tiles: [`${window.location.protocol}//${window.location.hostname}:${TILE_SERVER_PORT}/railway_parts_tile/{z}/{x}/{y}`],
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

export interface RoutePopupOptions {
  includeUsage?: boolean;
  includeTimes?: boolean;
  locale?: string;
}

export function createRoutePopupHTML(
  properties: Record<string, unknown>,
  options: RoutePopupOptions = {}
): string {
  const {
    includeUsage = true,
    includeTimes = true,
    locale = 'cs-CZ',
  } = options;

  let content = '<div class="railway-popup" style="color: black;">';

  if (properties.name) {
    content += `<h3 class="font-bold text-lg mb-2" style="color: black;">${properties.name}</h3>`;
  }

  let description = '';

  if (includeUsage && properties.usage_types) {
    // This will be populated by the component that knows how to parse usage types
    description += `<i style="color: black;">${properties.usage_types}</i>`;
  }

  if (properties.primary_operator) {
    description += description ? `, ${properties.primary_operator}` : properties.primary_operator;
  }

  if (properties.description) {
    description += `<br /><br /><span style="color: black;">${properties.description}</span>`;
  }

  if (includeTimes && properties.last_ride) {
    const formatter = new Intl.DateTimeFormat(locale);
    description += `<br /><br /><span style="color: black;">Naposledy projeto: ${formatter.format(new Date(properties.last_ride as string))}</span>`;
  }

  if (properties.note) {
    description += `<br /><br /><span style="color: black;">${properties.note}</span>`;
  }

  if (description) {
    content += `<div class="mb-2">${description}</div>`;
  }

  content += '</div>';

  return content;
}

// ============================================================================
// LAYER REFRESH HELPER
// ============================================================================

export interface RefreshLayerOptions {
  layerId: string;
  sourceId: string;
  sourceConfig: maplibregl.SourceSpecification;
  layerConfig: maplibregl.LayerSpecification;
  beforeLayerId?: string;
}

export function refreshVectorTileLayer(
  map: maplibregl.Map,
  options: RefreshLayerOptions
): void {
  const { layerId, sourceId, sourceConfig, layerConfig, beforeLayerId } = options;

  // Remove existing layer and source
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }

  // Re-add source and layer
  map.addSource(sourceId, sourceConfig);

  if (beforeLayerId) {
    map.addLayer(layerConfig, beforeLayerId);
  } else {
    map.addLayer(layerConfig);
  }
}
