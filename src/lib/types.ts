import type { UsageType } from './constants'

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
    usage?: number
    zoom_level?: number
    custom?: {
      date?: string
      note?: string
      partial?: boolean
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
  from_station: string
  to_station: string
  track_number?: string | null
  description: string | null
  usage_type: UsageType // 0=Regular, 1=Special
  frequency: string[] // Array of frequency tags (Daily, Weekdays, Weekends, Once a week, Seasonal)
  link?: string | null // External URL/link for the route
  scenic?: boolean | null // Flag to mark route as scenic
  geometry: string // GeoJSON string
  length_km?: number
  start_country?: string | null // ISO 3166-1 alpha-2 country code of start point
  end_country?: string | null // ISO 3166-1 alpha-2 country code of end point
  starting_part_id?: string | null
  ending_part_id?: string | null
  is_valid?: boolean
  error_message?: string | null
  intended_backtracking?: boolean // Flag to indicate backtracking is intentional
  has_backtracking?: boolean // Flag set by verification script indicating route uses backtracking path
  date?: string | null // From most recent journey
  journey_name?: string | null // From most recent journey (renamed from 'note')
  partial?: boolean | null // From most recent journey
}

// User journey from database (named, dated collection of routes)
export type Journey = {
  id: number
  user_id: number
  name: string // User-defined journey name (required, non-empty)
  description: string | null
  date: string // Journey date (required, YYYY-MM-DD)
  created_at: string
  updated_at: string
}

// Logged part from database (connects journeys to routes with partial flags)
export type LoggedPart = {
  id: number
  user_id: number
  journey_id: number
  track_id: number | null // Nullable to preserve history when routes are deleted
  partial: boolean // Per-journey partial flag
  created_at: string
}

// Local trip stored in localStorage (for unauthenticated users)
export type LocalTrip = {
  id: string // UUID
  track_id: string
  date: string // YYYY-MM-DD
  note: string | null
  partial: boolean
  created_at: string // ISO timestamp
}

// User preferences from database
export type UserPreferences = {
  user_id: number
  selected_countries: string[] // ISO 3166-1 alpha-2 country codes
  created_at: string
  updated_at: string
}

// Admin note from database
export type AdminNote = {
  id: number
  coordinate: [number, number] // [longitude, latitude]
  text: string
  created_at: string
  updated_at: string
}

// Pathfinding result (from railway pathfinder)
export interface PathResult {
  partIds: string[];
  coordinates: [number, number][];
  hasBacktracking?: boolean; // True if the final path contains backtracking
}

// Selected route for user map (used in JourneyLogger and map interactions)
export interface SelectedRoute {
  track_id: string;
  from_station: string;
  to_station: string;
  track_number: string | null;
  description: string;
  usage_types: string;
  link: string | null;
  date: string | null;
  journey_name: string | null; // Renamed from 'note'
  partial: boolean | null;
  length_km: number;
}
