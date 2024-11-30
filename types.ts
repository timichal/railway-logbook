import { Operator, Usage } from "./enums";

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
    railway: string
    _umap_options: {
      color: string
      weight?: number
    }
  }
}

export type RailwayData = {
  from: string
  to: string
  local_number: string | number
  usage: Usage[]
  primary_operator: Operator
  ways: string
  custom?: {
    last_ride?: string
    note?: string
  }
}
