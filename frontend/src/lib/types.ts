// Database types
export interface Station {
  id: number;
  name: string;
  coordinates: [number, number]; // [lon, lat]
}

export interface RailwayRoute {
  track_id: string;
  name: string;
  description: string;
  usage_types: string[];
  primary_operator: string;
  last_ride: Date;
  note: string;
  geometry: string;
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
    track_id?: string;
    primary_operator?: string;
    usage?: number[];
    description?: string;
    zoom_level?: number;
    custom?: {
      last_ride?: Date;
      note?: string;
    }
  };
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export interface RailwayPart {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  properties: {
    '@id': number;
    [key: string]: unknown;
  };
}
