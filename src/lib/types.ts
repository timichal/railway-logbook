// Types only, no enum imports needed (enums are used in definitions/ files)

export type Coord = [x: number, y: number];

type Geometry = {
  type: "Point"
  coordinates: Coord
} | {
  type: "LineString"
  coordinates: Coord[]
}

export type Feature = {
  type: "Feature"
  geometry: Geometry
  properties: {
    "@id": number
    railway: string
    subway: string
  }
}

export type EntryData = {
  features: Feature[]
}

export type ProcessedFeature = {
  type: "Feature"
  geometry: Geometry
  properties: {
    "@id": number | string
    name: string
    description: string
    track_id: string
    usage: number[]
    primary_operator: string
  }
}

export type ProcessedData = {
  features: ProcessedFeature[]
}

export type RailwayData = {
  from: string
  to: string
  local_number: string
  usage: number[]
  primary_operator: string
  ways: string
  description?: string
  custom?: {
    last_ride?: string
    note?: string
  }
}

// GeoJSON types for database queries
export type GeoJSONFeature = {
  type: 'Feature'
  geometry: {
    type: 'Point'
    coordinates: [number, number]
  } | {
    type: 'LineString'
    coordinates: [number, number][]
  }
  properties: {
    '@id'?: number | string
    name?: string
    track_id?: string
    description?: string
    usage?: number[]
    primary_operator?: string
    zoom_level?: number
    custom?: {
      last_ride?: string
      note?: string
    }
    [key: string]: unknown
  }
}

export type GeoJSONFeatureCollection = {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

// Railway part from database (specific GeoJSON feature)
export type RailwayPart = {
  type: 'Feature'
  geometry: {
    type: 'LineString'
    coordinates: [number, number][]
  }
  properties: {
    '@id': number | string
    [key: string]: unknown
  }
}

// Station from database
export type Station = {
  id: string | number
  name: string
  coordinates: [number, number]
}

// Railway route from database (with geometry as JSON string)
export type RailwayRoute = {
  track_id: string
  name: string
  description: string | null
  usage_types: string[]
  primary_operator: string
  geometry: string // GeoJSON string
  last_ride?: string | null
  note?: string | null
}
