/**
 * Public route and station reads, with no user in them at all.
 *
 * Route geometry and station names are public — they are served to everyone as
 * tiles — so unlike `progressQueries.ts` these are not withheld for privacy.
 * They live in a plain module for the other reason: a route handler must not
 * import a "use server" action (see MOBILE_APP_PLAN.md, Phase 1), so the query
 * is here and `userActions.ts` is one of its callers.
 */

import { boundsSql } from "./coordinateUtils";
import pool, { escapeLikePattern } from "./db";
import { onLineSql, routeLinesSql } from "./lineMembership";
import { MIN_SEARCH_QUERY_LENGTH, type UsageType } from "./shared/constants";
import { REGIONS, type RegionId, regionContainsSql } from "./shared/regions";
import { searchQueryLength } from "./shared/searchQuery";
import type {
  LineGeometry,
  LineSearchResult,
  MapSearchResults,
  RailwayRoute,
  RouteBounds,
  RouteSummary,
  Station,
} from "./shared/types";

/**
 * Station name search for the map search boxes and the Journey Planner.
 *
 * Restricted by default to `near_route` stations — the same set the user map
 * draws (public_stations_tile), so the autocomplete can't offer a station that
 * isn't on the map and has no route within reach of the planner. The admin map
 * draws every station (route creation needs the ones with no route yet), so its
 * search passes `nearRouteOnly: false` to match.
 *
 * Also restricted to the current region: the map is locked to it, so a hit in
 * the other one could neither be flown to nor routed from.
 *
 * Compared as `search_key` (02-vector-tiles.sql) on both sides — case,
 * diacritics, spaces and hyphens aside, so "owariseto" finds "Owari Seto": it is
 * what the trigram index on station names is built over, and the planner uses
 * that index only for the exact expression it indexes. The two-character floor is
 * counted without separators (`searchQueryLength`), so "a-" is one character.
 */
export async function searchStationsByName(
  searchQuery: string,
  region: RegionId,
  { nearRouteOnly = true }: { nearRouteOnly?: boolean } = {},
): Promise<Station[]> {
  if (searchQueryLength(searchQuery) < MIN_SEARCH_QUERY_LENGTH) {
    return [];
  }

  const pattern = escapeLikePattern(searchQuery);

  // A BIGINT id comes back from pg as a string
  const result = await pool.query<{ id: string; name: string; lon: number; lat: number }>(
    `
    SELECT id, name,
           ST_X(coordinates) as lon,
           ST_Y(coordinates) as lat
    FROM stations
    WHERE ($3 OR near_route)
      AND ${regionContainsSql(region, "coordinates")}
      AND search_key(name) LIKE search_key($1)
    ORDER BY
      CASE
        WHEN search_key(name) LIKE search_key($2) THEN 0  -- Start match first
        ELSE 1  -- Contains match second
      END,
      name
    LIMIT 10
  `,
    [`%${pattern}%`, `${pattern}%`, !nearRouteOnly],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    coordinates: [row.lon, row.lat],
  }));
}

/**
 * Line name search for the map search box, in a region that names its lines
 * (`hasRouteNames`); nothing elsewhere, where `name` is never set. The routes
 * sharing a name come back as one line, boxed round all of them, so picking it
 * shows the whole line. A route is on a line whether the line is its `name` or
 * one of its `other_names` (a stretch two lines share). Every usage type: a line is a place to look at, whichever
 * layers happen to be on. Matched as station names are — by `search_key`, start
 * matches first. Unindexed, which a region's few thousand routes do not need.
 *
 * The five names are picked before anything is boxed: `ST_Extent` reads each
 * route's whole (TOASTed) line, and a query like "Li" matches nearly every route
 * in Japan. A line with no geometry to box is dropped rather than returned with
 * bounds nobody can fly to.
 */
async function searchLinesByName(
  searchQuery: string,
  region: RegionId,
): Promise<LineSearchResult[]> {
  if (!REGIONS[region].hasRouteNames || searchQueryLength(searchQuery) < MIN_SEARCH_QUERY_LENGTH) {
    return [];
  }

  const pattern = escapeLikePattern(searchQuery);

  const result = await pool.query<{
    name: string;
    route_count: number;
    usage_types: UsageType[];
    bounds: RouteBounds;
  }>(
    `
    WITH matched AS (
      SELECT line.name,
             CASE WHEN search_key(line.name) LIKE search_key($2) THEN 0 ELSE 1 END AS rank
      FROM railway_routes rr
      CROSS JOIN LATERAL ${routeLinesSql("rr")} AS line(name)
      WHERE line.name IS NOT NULL
        AND ${regionContainsSql(region, "rr.starting_coordinate")}
        AND search_key(line.name) LIKE search_key($1)
      GROUP BY line.name
      ORDER BY rank, line.name
      LIMIT 5
    )
    SELECT name, route_count, usage_types, ${boundsSql("box")} AS bounds
    FROM (
      SELECT m.name, m.rank, count(*)::int AS route_count,
             array_agg(DISTINCT rr.usage_type ORDER BY rr.usage_type) AS usage_types,
             ST_Extent(rr.geometry) AS box
      FROM matched m
      JOIN railway_routes rr ON ${onLineSql("rr", "m.name")}
      WHERE ${regionContainsSql(region, "rr.starting_coordinate")}
      GROUP BY m.name, m.rank
    ) lines
    WHERE box IS NOT NULL
    ORDER BY rank, name
  `,
    [`%${pattern}%`, `${pattern}%`],
  );

  return result.rows.map((row) => ({
    name: row.name,
    routeCount: row.route_count,
    usageTypes: row.usage_types,
    bounds: row.bounds,
  }));
}

/**
 * A searched line's geometry, for its highlight band on the map: the routes on the
 * line (by `name` or `other_names`) merged into as few lines as they make, one entry per usage type among
 * them (so the map can leave out what its layer switches hide).
 *
 * Merged because the band is translucent, and MapLibre blends wherever a layer's
 * features overlap: drawn per route, every junction between two of the line's routes
 * is a pair of round caps on top of each other, i.e. a dark blot. Consecutive routes
 * do not share their endpoint exactly — each is its own hand-picked click point, a
 * few metres from the next — so each endpoint is first moved to the midpoint between
 * it and the nearest endpoint of *another* route within `LINE_ENDPOINT_SNAP`, after
 * which `ST_LineMerge` can join the two. Pairwise rather than clustered: a cluster
 * chains (A near B near C), so it can drag an end further than the snap distance,
 * and it can take in both ends of a short connector and collapse it to a point. An
 * end moves at most half the snap distance, and never towards its own route's other
 * end. Endpoints of one line's routes sit within ~20m of each other or hundreds of
 * metres apart, nothing in between, so the snap neither misses a junction nor joins
 * two that are not one.
 *
 * Simplified only to what no zoom shows (`LINE_SIMPLIFY`, ~2m): the per-zoom
 * simplification the scenic tile does in SQL is done here by the GeoJSON source
 * itself, and the long Japanese main lines come to some 50KB.
 */
const LINE_ENDPOINT_SNAP = 50; // EPSG:3857 units, ~40m in Europe and Japan
const LINE_SIMPLIFY = 3; // EPSG:3857 units

export async function lineGeometryByName(name: string, region: RegionId): Promise<LineGeometry[]> {
  const result = await pool.query<{ usage_type: UsageType; geometry: LineGeometry["geometry"] }>(
    `
    WITH routes AS (
      SELECT track_id, usage_type, geometry_3857 AS geom
      FROM railway_routes rr
      WHERE ${onLineSql("rr", "$1")}
        AND geometry_3857 IS NOT NULL
        AND ${regionContainsSql(region, "starting_coordinate")}
    ),
    ends AS (
      SELECT track_id, true AS is_start, ST_StartPoint(geom) AS pt FROM routes
      UNION ALL
      SELECT track_id, false, ST_EndPoint(geom) FROM routes
    ),
    snapped_ends AS (
      SELECT e.track_id, e.is_start,
             CASE WHEN partner.pt IS NULL THEN e.pt
                  ELSE ST_Centroid(ST_Collect(e.pt, partner.pt)) END AS pt
      FROM ends e
      LEFT JOIN LATERAL (
        SELECT o.pt
        FROM ends o
        WHERE o.track_id <> e.track_id AND ST_DWithin(o.pt, e.pt, $2)
        ORDER BY o.pt <-> e.pt
        LIMIT 1
      ) partner ON true
    ),
    snapped AS (
      SELECT r.usage_type,
             ST_SetPoint(ST_SetPoint(r.geom, 0, s.pt), ST_NPoints(r.geom) - 1, e.pt) AS geom
      FROM routes r
      JOIN snapped_ends s ON s.track_id = r.track_id AND s.is_start
      JOIN snapped_ends e ON e.track_id = r.track_id AND NOT e.is_start
    )
    SELECT usage_type,
           ST_AsGeoJSON(
             ST_Transform(ST_Simplify(ST_LineMerge(ST_Collect(geom)), $3), 4326),
             6
           )::json AS geometry
    FROM snapped
    GROUP BY usage_type
    ORDER BY usage_type
  `,
    [name, LINE_ENDPOINT_SNAP, LINE_SIMPLIFY],
  );

  return result.rows.map((row) => ({ usageType: row.usage_type, geometry: row.geometry }));
}

/**
 * Everything the map's search box offers for a query, in one call: a server action
 * is dispatched one at a time per client, so two actions per keystroke would run
 * back to back. Lines only where the region names them (see searchLinesByName), and
 * a failed line search costs only the lines — the stations are what the box is for.
 */
export async function searchMapByName(
  searchQuery: string,
  region: RegionId,
  { nearRouteOnly = true }: { nearRouteOnly?: boolean } = {},
): Promise<MapSearchResults> {
  const [lines, stations] = await Promise.all([
    searchLinesByName(searchQuery, region).catch((error) => {
      console.error("Error searching lines:", error);
      return [];
    }),
    searchStationsByName(searchQuery, region, { nearRouteOnly }),
  ]);
  return { lines, stations };
}

/**
 * The track ids of every route in a region.
 *
 * A few thousand integers, cheap to ship whole, and the only thing the
 * localStorage journey list can use to tell which of its journeys belong to the
 * region on screen: it stores track ids and nothing else, so unlike the
 * database journey list it cannot ask the question in SQL.
 */
export async function trackIdsInRegion(region: RegionId): Promise<number[]> {
  const result = await pool.query<{ track_id: number }>(`
    SELECT track_id
    FROM railway_routes
    WHERE ${regionContainsSql(region, "starting_coordinate")}
  `);

  return result.rows.map((row) => row.track_id);
}

/**
 * Every route in a region, reduced to what progress needs (`RouteSummary`). The
 * logged-out map works out its progress and colouring from this client-side, and
 * waits for it to do so: with geometry the list is ~50MB for Europe, which held
 * the local rides off the map for seconds on every load.
 */
export async function routeSummariesInRegion(region: RegionId): Promise<RouteSummary[]> {
  const result = await pool.query<RouteSummary>(`
    SELECT track_id, usage_type, length_km, start_country, end_country
    FROM railway_routes
    WHERE ${regionContainsSql(region, "starting_coordinate")}
    ORDER BY track_id
  `);

  return result.rows;
}

/**
 * The bounding box of a set of routes, or null when none of them is there. What the
 * user map fits to when a journey, trip or plan is opened: its highlights are
 * tile-filter overlays carrying only ids, so the client has no geometry of its own
 * to measure.
 *
 * Only the routes in `region` count. A journey or trip is not scoped to one — a
 * trip may hold a ride in Czechia and one in Japan — and a box spanning both would
 * fit the Europe view zoomed out to the whole continent. `null` takes every route,
 * for a set that cannot straddle the two (a planner result).
 */
export async function routeBoundsByIds(
  trackIds: number[],
  region: RegionId | null,
): Promise<RouteBounds | null> {
  if (trackIds.length === 0) return null;

  const inRegion = region ? `AND ${regionContainsSql(region, "starting_coordinate")}` : "";
  const result = await pool.query<{ bounds: RouteBounds }>(
    `
    SELECT ${boundsSql("box")} AS bounds
    FROM (
      SELECT ST_Extent(geometry) AS box
      FROM railway_routes
      WHERE track_id = ANY($1::int[]) ${inRegion}
    ) e
    WHERE box IS NOT NULL
  `,
    [trackIds],
  );

  return result.rows[0]?.bounds ?? null;
}

/**
 * Metadata (no geometry) for a specific set of routes by track_id. Used to
 * label logged parts held in localStorage, which retain only the track id.
 */
export async function routeMetadataByIds(trackIds: number[]): Promise<RailwayRoute[]> {
  if (trackIds.length === 0) return [];

  const result = await pool.query<Omit<RailwayRoute, "geometry">>(
    `
    SELECT
      track_id,
      name,
      other_names,
      from_station,
      to_station,
      description,
      usage_type,
      frequency,
      link,
      link_name,
      line_class,
      length_km,
      start_country,
      end_country,
      is_valid
    FROM railway_routes
    WHERE track_id = ANY($1::int[])
  `,
    [trackIds],
  );

  return result.rows.map((row) => ({
    ...row,
    geometry: "",
  }));
}
