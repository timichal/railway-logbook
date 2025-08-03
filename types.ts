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
  }
}

export type ProcessedData = {
  features: ProcessedFeature[]
}

export type RailwayData = {
  from: string
  to: string
  local_number: string
  usage: Usage[]
  primary_operator: Operator
  ways: string
  description?: string
  custom?: {
    last_ride?: string
    note?: string
  }
}
