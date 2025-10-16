// Types for pruneData.ts script
export type Feature = {
  type: "Feature"
  geometry: {
    type: "Point" | "LineString"
    coordinates: [number, number] | [number, number][]
  }
  properties: {
    "@id"?: number
    railway?: string
    subway?: string
    name?: string
    usage?: string
    [key: string]: string | number | undefined
  }
}

export type EntryData = {
  features: Feature[]
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
      date?: string
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
  date?: string | null
  note?: string | null
}
