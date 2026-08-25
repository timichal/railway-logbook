import type { LineClass, NoteType, UsageType } from "./constants";

// Types for pruneData.ts script
// Raw feature as produced by `osmium export` and consumed by pruneData.ts.
// Areas show up too: a closed way tagged railway=station is exported as a
// MultiPolygon (and, unless it carries area=yes, a second time as a LineString).
export type Feature = {
  type: "Feature";
  geometry: {
    type: "Point" | "LineString" | "Polygon" | "MultiPolygon";
    coordinates:
      | [number, number]
      | [number, number][]
      | [number, number][][]
      | [number, number][][][];
  };
  properties: {
    "@id"?: number;
    railway?: string;
    subway?: string;
    name?: string;
    usage?: string;
    [key: string]: string | number | undefined;
  };
};

// GeoJSON types for database queries
export type GeoJSONFeature = {
  type: "Feature";
  geometry:
    | {
        type: "Point";
        coordinates: [number, number];
      }
    | {
        type: "LineString";
        coordinates: [number, number][];
      };
  properties: {
    "@id"?: number | string;
    name?: string;
    track_id?: number;
    description?: string;
    usage?: number;
    zoom_level?: number;
    custom?: {
      date?: string;
      note?: string;
      partial?: boolean;
    };
    [key: string]: unknown;
  };
};

export type GeoJSONFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
};

// Railway part from database (specific GeoJSON feature)
export type RailwayPart = {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  properties: {
    "@id": number | string;
    [key: string]: unknown;
  };
};

// Station from database
export type Station = {
  id: string | number;
  name: string;
  coordinates: [number, number];
};

// Railway route from database (with geometry as JSON string)
export type RailwayRoute = {
  track_id: number;
  from_station: string;
  to_station: string;
  description: string | null;
  usage_type: UsageType; // 0=Regular, 1=Heritage, 2=Special
  frequency: string[]; // Array of frequency tags (Daily, Weekdays, Weekends, Once a week, Seasonal)
  link?: string | null; // External URL/link for the route
  scenic?: boolean | null; // Flag to mark route as scenic
  line_class?: LineClass | null; // Line classification: highspeed, main, branch
  geometry: string; // GeoJSON string
  length_km?: number;
  start_country?: string | null; // ISO 3166-1 alpha-2 country code of start point
  end_country?: string | null; // ISO 3166-1 alpha-2 country code of end point
  starting_part_id?: string | null;
  ending_part_id?: string | null;
  is_valid?: boolean;
  error_message?: string | null;
  under_repair?: boolean; // Invalid only because the OSM layout is temporarily broken (admin-set)
  intended_backtracking?: boolean; // Flag to indicate backtracking is intentional
  has_backtracking?: boolean; // Flag set by verification script indicating route uses backtracking path
  date?: string | null; // From most recent journey
  journey_name?: string | null; // From most recent journey (renamed from 'note')
  partial?: boolean | null; // From most recent journey
};

// User trip from database (groups of journeys)
export type Trip = {
  id: number;
  user_id: number;
  name: string; // User-defined trip name (required, non-empty)
  description: string | null;
  created_at: string;
  updated_at: string;
};

// User journey from database (named, dated collection of routes)
export type Journey = {
  id: number;
  user_id: number;
  name: string; // User-defined journey name (required, non-empty)
  description: string | null;
  date: string; // Journey date (required, YYYY-MM-DD)
  trip_id: number | null; // Optional trip grouping
  created_at: string;
  updated_at: string;
};

// Logged part from database (connects journeys to routes with partial flags)
export type LoggedPart = {
  id: number;
  user_id: number;
  journey_id: number;
  track_id: number | null; // Nullable to preserve history when routes are deleted
  partial: boolean; // Per-journey partial flag
  // Stretch ridden as fractions along the route geometry; NULL when unknown
  // (see CoveredRange and user_logged_parts.covered_start)
  covered_start?: number | null;
  covered_end?: number | null;
  created_at: string;
};

// Local journey stored in localStorage (for unauthenticated users)
export type LocalJourney = {
  id: string; // UUID
  name: string; // User-defined journey name (required, non-empty)
  description: string | null;
  date: string; // YYYY-MM-DD
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
};

// Local logged part stored in localStorage (for unauthenticated users)
export type LocalLoggedPart = {
  id: string; // UUID
  journey_id: string; // References LocalJourney.id
  track_id: number; // References railway_routes.track_id
  partial: boolean;
  // Stretch ridden as fractions along the route geometry; absent when unknown
  // (mirrors user_logged_parts.covered_start/covered_end — see CoveredRange)
  covered_start?: number | null;
  covered_end?: number | null;
  created_at: string; // ISO timestamp
};

// User preferences from database
export type UserPreferences = {
  user_id: number;
  selected_countries: string[]; // ISO 3166-1 alpha-2 country codes
  created_at: string;
  updated_at: string;
};

// Admin note from database
export type AdminNote = {
  id: number;
  coordinate: [number, number]; // [longitude, latitude]
  text: string;
  note_type: NoteType;
  source: string | null; // Optional external link, shown in the note popup
  created_at: string;
  updated_at: string;
};

/**
 * Where a path turns back on itself: the connection between two consecutive
 * parts whose bearings differ by more than BACKTRACKING_THRESHOLD_DEGREES.
 *
 * The first such connection only — the detection stops at it — which is enough
 * to point an editor at the offending OSM way (`npm run showBacktracking`).
 */
export interface BacktrackingPoint {
  /** OSM way id of the part the path leaves. */
  fromPartId: string;
  /** OSM way id of the part it turns back onto. */
  toPartId: string;
  /** Bearing difference at the connection, 0-180 degrees. */
  angleDegrees: number;
  /** The connection point itself, [longitude, latitude]. */
  coordinate: [number, number];
}

// Pathfinding result (from railway pathfinder)
export interface PathResult {
  partIds: string[];
  coordinates: [number, number][];
  hasBacktracking?: boolean; // True if the final path contains backtracking
  /** Where it backtracks, set whenever hasBacktracking is true. */
  backtrackingAt?: BacktrackingPoint;
}

/**
 * Highlight colour on the user map:
 * 'planner'  — pathfinder result between two stations (gold)
 * 'view'     — viewing journeys/trips in My Trips (orange, matches admin selection)
 */
export type HighlightKind = "planner" | "view";

/**
 * Light up routes on the user map. Passing an empty list clears the highlight.
 */
export type HighlightRoutesFn = (
  routeIds: number[],
  kind?: HighlightKind,
  /**
   * Routes the highlight should only cover part of — a journey plan can join its
   * first/last route mid-way. These are drawn from their own geometry, since the
   * tile filter can only light up a whole route.
   */
  partials?: PartialRouteGeometry[],
) => void;

/**
 * Which stretch of a route was covered, as fractions along its geometry
 * (`ST_LineLocatePoint` space, 0 = the geometry's first point).
 *
 * This is the durable form: it survives the route geometry being recalculated
 * after an OSM update, where stored coordinates would not.
 */
export interface CoveredRange {
  track_id: number;
  covered_start: number;
  covered_end: number;
}

/**
 * A covered range plus the geometry it resolves to, ready to draw. Journey plans
 * produce these for a route they join mid-way, and logged partial rides for the
 * stretch already ridden — in both cases as their own GeoJSON overlay, because
 * the tile-filter highlight can only light up whole routes.
 */
export interface PartialRouteGeometry extends CoveredRange {
  coordinates: [number, number][];
}

/**
 * A ridden stretch of a route, with what the map needs to style and filter it —
 * the overlay has to honour the same country filter and Regular-only filter as
 * the route layer it is drawn over.
 */
export interface CoveredStretch extends PartialRouteGeometry {
  line_class: LineClass | null;
  usage_type: UsageType;
  start_country: string | null;
  end_country: string | null;
}

/** One route in a Journey Planner result. */
export interface PlannerRoute {
  track_id: number;
  from_station: string;
  to_station: string;
  description: string;
  /** Full length of the route. */
  length_km: number;
  /** Length actually covered by the plan — below length_km on a partial route. */
  travelled_length_km: number;
  /** Set when only part of the route is covered; carries the covered stretch. */
  partial?: PartialRouteGeometry;
}

// Selected route for user map (used in JourneyLogger and map interactions)
export interface SelectedRoute {
  track_id: number;
  from_station: string;
  to_station: string;
  description: string;
  usage_types: string;
  link: string | null;
  date: string | null;
  journey_name: string | null; // Renamed from 'note'
  partial: boolean | null;
  length_km: number;
  /**
   * Stretch ridden, when known — set by the Journey Planner for a route it joins
   * mid-way. Its fractions are carried through to user_logged_parts on logging,
   * and its geometry is what the selection highlight draws, so only the part
   * being logged lights up. Null for a route ticked partial by hand, whose
   * extent nobody knows.
   */
  covered?: PartialRouteGeometry | null;
}
