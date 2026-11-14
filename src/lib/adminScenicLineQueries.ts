/**
 * The admin page's reads of scenic lines: the list and the endpoints. A plain
 * module for the reason `adminRouteQueries.ts` gives; the `api/admin` handlers
 * check the admin before calling it.
 */

import { boundsSql, lngLatSql } from "./coordinateUtils";
import pool from "./db";
import { type RegionId, regionContainsSql } from "./shared/regions";
import type { GeoJSONFeature, GeoJSONFeatureCollection, RouteBounds } from "./shared/types";

/** One scenic line as the admin list shows and edits it. */
export type AdminScenicLine = {
  id: number;
  from_station: string;
  to_station: string;
  length_km: number;
  is_valid: boolean;
  error_message: string | null;
  /** The line's box, which the map flies to. */
  bounds: RouteBounds;
  /** The stored click points the line is recalculated from. */
  starting_coordinate: [number, number];
  ending_coordinate: [number, number];
};

/**
 * The region's scenic lines, by bounding box as the admin routes list is — a
 * line may run through a country outside SUPPORTED_COUNTRIES. Each with its box:
 * a line picked from the list is flown to at once.
 * Unordered: the tab sorts it, as the routes list is sorted (`adminListSort.ts`).
 */
export async function adminScenicLines(region: RegionId): Promise<AdminScenicLine[]> {
  const result = await pool.query<AdminScenicLine>(`
    SELECT id, from_station, to_station, length_km, is_valid, error_message,
           ${boundsSql("geometry")} AS bounds,
           ${lngLatSql("starting_coordinate")} AS starting_coordinate,
           ${lngLatSql("ending_coordinate")} AS ending_coordinate
    FROM scenic_lines
    WHERE ${regionContainsSql(region, "starting_coordinate")}
  `);
  return result.rows;
}

/**
 * The region's scenic line endpoints, for the admin map's dots in scenic mode
 * (a GeoJSON FeatureCollection of Points, as `routeEndpoints` is for routes).
 */
export async function scenicLineEndpoints(region: RegionId): Promise<GeoJSONFeatureCollection> {
  const result = await pool.query<{
    id: number;
    from_station: string;
    to_station: string;
    start: [number, number];
    end: [number, number];
  }>(`
    SELECT id, from_station, to_station,
           ${lngLatSql("starting_coordinate")} AS start, ${lngLatSql("ending_coordinate")} AS end
    FROM scenic_lines
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
            scenic_line_id: row.id,
            endpoint_type: endpoint,
            line_name: `${row.from_station} ⟷ ${row.to_station}`,
          },
        }),
      ),
    ),
  };
}
