"use server";

import type { ActionResult } from "./actionResult";
import { findAdminPath } from "./adminPathSearch";
import { requiredStations, SCENIC_BACKTRACKING_ERROR } from "./adminValidation";
import { asAdmin } from "./authHelpers";
import { boundsSql, coordinatesToWKT, lngLatSql, pointToWKT } from "./coordinateUtils";
import { countryAt } from "./countryUtils";
import pool from "./db";
import { ValidationError } from "./errors";
import { lineLengthKmSql } from "./lineLength";
import { type RegionId, regionContainsSql } from "./shared/regions";
import type { GeoJSONFeature, GeoJSONFeatureCollection, RouteBounds } from "./shared/types";

/**
 * Scenic lines: stretches of track the user map highlights as scenic.
 *
 * Drawn like a route — two click points and the path the admin pathfinder finds
 * between them (`useRoutePreview`), recalculated from the same points on every
 * OSM import (`verifyRouteData`) — but highlight only: two names and a geometry,
 * nothing logged against them, nothing derived from them.
 *
 * A scenic line never backtracks (`SCENIC_BACKTRACKING_ERROR`). Its paths are
 * searched with `avoidBacktracking`, by the preview, the save and the
 * recalculation alike. A save finds the path again from the click points rather
 * than taking the previewed one, and refuses it if it turns back on itself; a
 * recalculation that comes out backtracking marks the line invalid.
 */

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

/** The path between the click points as WKT, refused if there is none or it backtracks. */
async function scenicLineWKT(
  startCoordinate: [number, number],
  endCoordinate: [number, number],
): Promise<string> {
  const path = await findAdminPath(startCoordinate, endCoordinate, { avoidBacktracking: true });
  if (!path || path.coordinates.length < 2) {
    throw new ValidationError("No path found between the picked points");
  }
  if (path.hasBacktracking) {
    throw new ValidationError(SCENIC_BACKTRACKING_ERROR);
  }
  return coordinatesToWKT(path.coordinates);
}

/**
 * The region's scenic lines, by bounding box as the admin routes list is — a
 * line may run through a country outside SUPPORTED_COUNTRIES. Each with its box:
 * a line picked from the list is flown to at once.
 * Unordered: the tab sorts it, as the routes list is sorted (`adminListSort.ts`).
 */
export async function getScenicLines(region: RegionId): Promise<ActionResult<AdminScenicLine[]>> {
  return asAdmin(async () => {
    const result = await pool.query<AdminScenicLine>(`
      SELECT id, from_station, to_station, length_km, is_valid, error_message,
             ${boundsSql("geometry")} AS bounds,
             ${lngLatSql("starting_coordinate")} AS starting_coordinate,
             ${lngLatSql("ending_coordinate")} AS ending_coordinate
      FROM scenic_lines
      WHERE ${regionContainsSql(region, "starting_coordinate")}
    `);
    return result.rows;
  });
}

/**
 * The region's scenic line endpoints, for the admin map's dots in the Scenic tab
 * (a GeoJSON FeatureCollection of Points, as `getAllRouteEndpoints` is for routes).
 */
export async function getScenicLineEndpoints(
  region: RegionId,
): Promise<ActionResult<GeoJSONFeatureCollection>> {
  return asAdmin(async () => {
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
  });
}

/** Create a scenic line along the path between two click points. Returns its id. */
export async function createScenicLine(
  fromStation: string,
  toStation: string,
  startCoordinate: [number, number],
  endCoordinate: [number, number],
): Promise<ActionResult<number>> {
  return asAdmin(async () => {
    const { from, to } = requiredStations(fromStation, toStation, "A scenic line");
    const geometryWKT = await scenicLineWKT(startCoordinate, endCoordinate);
    const startCountry = countryAt(startCoordinate);
    const endCountry = countryAt(endCoordinate);
    const result = await pool.query<{ id: number }>(
      `
      INSERT INTO scenic_lines (
        from_station, to_station, geometry, length_km, start_country, end_country,
        starting_coordinate, ending_coordinate
      ) VALUES (
        $1, $2, ST_GeomFromText($3, 4326), ${lineLengthKmSql("$3")},
        $4, $5, ST_GeomFromText($6, 4326), ST_GeomFromText($7, 4326)
      )
      RETURNING id
      `,
      [
        from,
        to,
        geometryWKT,
        startCountry,
        endCountry,
        pointToWKT(startCoordinate),
        pointToWKT(endCoordinate),
      ],
    );
    return result.rows[0].id;
  });
}

/** Replace a scenic line's geometry with the path between re-picked points, which also makes it valid again. */
export async function updateScenicLineGeometry(
  id: number,
  startCoordinate: [number, number],
  endCoordinate: [number, number],
): Promise<ActionResult<void>> {
  return asAdmin(async () => {
    // Before the search, which loads parts for up to 222km around both points; the
    // UPDATE's own check still covers a line deleted while it runs.
    const exists = await pool.query("SELECT 1 FROM scenic_lines WHERE id = $1", [id]);
    if (exists.rowCount === 0) throw new ValidationError("Scenic line not found");
    const geometryWKT = await scenicLineWKT(startCoordinate, endCoordinate);
    const startCountry = countryAt(startCoordinate);
    const endCountry = countryAt(endCoordinate);
    const result = await pool.query(
      `
      UPDATE scenic_lines
      SET geometry = ST_GeomFromText($2, 4326),
          length_km = ${lineLengthKmSql("$2")},
          start_country = $3,
          end_country = $4,
          starting_coordinate = ST_GeomFromText($5, 4326),
          ending_coordinate = ST_GeomFromText($6, 4326),
          is_valid = TRUE,
          error_message = NULL
      WHERE id = $1
      `,
      [
        id,
        geometryWKT,
        startCountry,
        endCountry,
        pointToWKT(startCoordinate),
        pointToWKT(endCoordinate),
      ],
    );
    if (result.rowCount === 0) throw new ValidationError("Scenic line not found");
  });
}

/** Rename a scenic line's endpoints. */
export async function updateScenicLineNames(
  id: number,
  fromStation: string,
  toStation: string,
): Promise<ActionResult<void>> {
  return asAdmin(async () => {
    const { from, to } = requiredStations(fromStation, toStation, "A scenic line");
    const result = await pool.query(
      "UPDATE scenic_lines SET from_station = $2, to_station = $3 WHERE id = $1",
      [id, from, to],
    );
    if (result.rowCount === 0) throw new ValidationError("Scenic line not found");
  });
}

export async function deleteScenicLine(id: number): Promise<ActionResult<void>> {
  return asAdmin(async () => {
    const result = await pool.query("DELETE FROM scenic_lines WHERE id = $1", [id]);
    if (result.rowCount === 0) throw new ValidationError("Scenic line not found");
  });
}
