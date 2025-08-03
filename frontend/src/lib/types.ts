// Database types
export interface Station {
  id: number;
  name: string;
  coordinates: [number, number]; // [lon, lat]
}

export interface RailwayRoute {
  track_id: string;
  name: string;
  usage_types: string[];
  primary_operator: string;
  geometry: {
    type: 'LineString';
    coordinates: number[][];
  };
  color: string;
  weight: number;
}

export interface UserRailwayData {
  user_id: number;
  track_id: string;
  last_ride?: string;
  note?: string;
}

// Combined types for frontend use
export interface RailwayRouteWithUserData extends RailwayRoute {
  user_data?: UserRailwayData;
}

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'LineString';
    coordinates: number[] | number[][];
  };
  properties: {
    '@id'?: number;
    name?: string;
    description?: string;
    track_id?: string;
    railway?: string;
    _umap_options?: {
      color?: string;
      weight?: number;
    };
  };
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}