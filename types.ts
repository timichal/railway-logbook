type Coord = [x: number, y: number];

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
