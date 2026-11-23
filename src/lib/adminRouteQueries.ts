/**
 * The admin page's reads of routes: the list, one route, the endpoints, the km
 * counter and the editor's suggestions. A plain module, not a `"use server"` one,
 * so the `api/admin` route handlers can call it (every export of a `"use server"`
 * file is a client-callable endpoint, and a route handler never imports one).
 * The handlers check the admin first (`adminRead`); nothing here does.
 */

import { boundsSql, lngLatSql } from "./coordinateUtils";
import pool from "./db";
import { NotFoundError } from "./errors";
import { routeLinesSql } from "./lineMembership";
import type { LineClass, UsageType } from "./shared/constants";
import { type RegionId, regionContainsSql } from "./shared/regions";
import type { GeoJSONFeature, GeoJSONFeatureCollection, RouteBounds } from "./shared/types";

/** A row of the admin routes list: the route's metadata and flags, no geometry. */
export type AdminRouteSummary = {
  track_id: number;
  /** Line name where the region names its lines, NULL elsewhere. */
  name: string | null;
  /** The other lines sharing the route; empty unless `name` is set. */
  other_names: string[];
  from_station: string;
  to_station: string;
  description: string | null;
  usage_type: UsageType;
  /** In the list for its "Without usage tags" filter. */
  usage_tags: string[];
  line_class: LineClass;
  is_valid: boolean;
  error_message: string | null;
  under_repair: boolean;
  closed: boolean;
  intended_backtracking: boolean;
  has_backtracking: boolean;
};

/**
 * One route as the admin edits it: the list row's fields plus what the edit
 * form, the map focus and the geometry re-pick need.
 */
export type AdminRouteDetail = AdminRouteSummary & {
  link: string | null;
  link_name: string | null;
  /** When a closed route's service ended (YYYY-MM-DD), where known. */
  closed_on: string | null;
  /** The route's box, which the map flies to. */
  bounds: RouteBounds;
  length_km: number;
  /** The stored click points the route is recalculated from. */
  starting_coordinate: [number, number];
  ending_coordinate: [number, number];
};

/**
 * All railway routes of one region (list view, no geometry).
 *
 * Region-filtered by bounding box rather than by country code: the admin can
 * create a route anywhere OSM has track, including countries outside
 * SUPPORTED_COUNTRIES, and those must still show up in the list of the region
 * they were drawn in.
 *
 * Unordered, because the list sorts itself (`AdminRoutesTab`): a text sort
 * under the database's collation was ~340ms of a ~510ms query.
 */
export async function adminRoutes(region: RegionId): Promise<AdminRouteSummary[]> {
  const result = await pool.query<AdminRouteSummary>(`
    SELECT track_id, name, other_names, from_station, to_station, description, usage_type, usage_tags, line_class,
           is_valid, error_message, under_repair, closed, intended_backtracking, has_backtracking
    FROM railway_routes
    WHERE ${regionContainsSql(region, "starting_coordinate")}
  `);

  return result.rows;
}

/**
 * The total length (km) of the region's valid routes that still run (closed
 * ones left out, as progress leaves them out). Powers the admin map km counter,
 * which sits beside a map showing that region alone.
 */
export async function validRoutesTotalKm(region: RegionId): Promise<number> {
  const result = await pool.query<{ total_km: number }>(`
    SELECT COALESCE(SUM(length_km), 0) AS total_km
    FROM railway_routes
    WHERE is_valid = true
      AND NOT closed
      AND ${regionContainsSql(region, "starting_coordinate")}
  `);

  return Math.round(result.rows[0].total_km * 10) / 10;
}

/** What the route editor's tag inputs suggest: values already in use on some route. */
export type RouteSuggestions = {
  /** The usage tags. */
  tags: string[];
  /** Every line name, a route's own or one it shares, for the Other lines field. */
  lineNames: string[];
};

/**
 * The usage tags and line names currently in use across all routes. Neither
 * has a table of its own: one exists exactly as long as some route carries it, so
 * dropping the last use removes it implicitly. Not per region — names are only
 * ever set where the region names its lines.
 */
export async function routeSuggestions(): Promise<RouteSuggestions> {
  const result = await pool.query<RouteSuggestions>(`
    SELECT
      ARRAY(
        SELECT DISTINCT tag
        FROM railway_routes, unnest(usage_tags) AS tag
        WHERE tag IS NOT NULL AND tag <> ''
        ORDER BY tag
      ) AS tags,
      ARRAY(
        SELECT DISTINCT line_name
        FROM railway_routes rr, ${routeLinesSql("rr")} AS line_name
        WHERE line_name IS NOT NULL AND line_name <> ''
        ORDER BY line_name
      ) AS "lineNames"
  `);

  return result.rows[0];
}

/**
 * The columns of an `AdminRouteDetail`. The writes the route editor makes return
 * them (`RETURNING`), so the editor shows what was stored without reading it back.
 */
export const ROUTE_DETAIL_COLUMNS = `
  track_id, name, other_names, from_station, to_station, description, usage_type, usage_tags, link, link_name, line_class,
  ${boundsSql("geometry")} as bounds, length_km,
  ${lngLatSql("starting_coordinate")} as starting_coordinate,
  ${lngLatSql("ending_coordinate")} as ending_coordinate,
  is_valid, error_message, under_repair, closed, closed_on,
  intended_backtracking, has_backtracking
`;

/**
 * How many partial rides users have logged on the route. A geometry re-pick of a
 * route that backtracks (before or after) can't place their stretches and logs them
 * whole (`reprojectCoveredRanges`), which the editor warns about before the save.
 */
export async function partialRideCount(trackId: number): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM user_logged_parts WHERE track_id = $1 AND partial",
    [trackId],
  );
  return result.rows[0].count;
}

/** A single railway route by track_id, as the admin edits it. */
export async function adminRoute(trackId: number): Promise<AdminRouteDetail> {
  const result = await pool.query<AdminRouteDetail>(
    `
    SELECT ${ROUTE_DETAIL_COLUMNS}
    FROM railway_routes
    WHERE track_id = $1
  `,
    [trackId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new NotFoundError("Route not found");
  }
  return row;
}

/**
 * The region's route endpoints (starting and ending coordinates) for map
 * display, as a GeoJSON FeatureCollection of Point features.
 */
export async function routeEndpoints(region: RegionId): Promise<GeoJSONFeatureCollection> {
  const result = await pool.query<{
    track_id: number;
    from_station: string;
    to_station: string;
    start: [number, number];
    end: [number, number];
  }>(`
    SELECT track_id, from_station, to_station,
           ${lngLatSql("starting_coordinate")} AS start, ${lngLatSql("ending_coordinate")} AS end
    FROM railway_routes
    WHERE ${regionContainsSql(region, "starting_coordinate")}
  `);

  return {
    type: "FeatureCollection",
    features: result.rows.flatMap((row) =>
      (["start", "end"] as const).map(
        (endpoint): GeoJSONFeature => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: row[endpoint] },
          properties: {
            track_id: row.track_id,
            endpoint_type: endpoint,
            route_name: `${row.from_station} ⟷ ${row.to_station}`,
          },
        }),
      ),
    ),
  };
}
