"use server";

import type { ActionResult } from "./actionResult";
import { asAdmin } from "./authHelpers";
import { coordinatesToWKT } from "./coordinateUtils";
import { getRouteCountries } from "./countryUtils";
import pool from "./db";
import { ValidationError } from "./errors";
import { lineLengthKmSql } from "./lineLength";
import { type RegionId, regionEnvelopeSql } from "./shared/regions";

/**
 * Scenic lines: stretches of track the user map highlights as scenic.
 *
 * Drawn like a route — two click points and the path the admin pathfinder finds
 * between them (`useRoutePreview`), recalculated from the same points on every
 * OSM import (`verifyRouteData`) — but highlight only: two names and a geometry,
 * nothing logged against them, nothing derived from them.
 */

/** One scenic line as the admin list shows and edits it. */
export type AdminScenicLine = {
  id: number;
  from_station: string;
  to_station: string;
  length_km: number;
  is_valid: boolean;
  error_message: string | null;
  /** GeoJSON LineString, as a string — what the map flies to. */
  geometry: string;
  /** The stored click points the line is recalculated from. */
  starting_coordinate: [number, number];
  ending_coordinate: [number, number];
};

type AdminScenicLineRow = Omit<AdminScenicLine, "starting_coordinate" | "ending_coordinate"> & {
  starting_coordinate: { coordinates: [number, number] };
  ending_coordinate: { coordinates: [number, number] };
};

function requiredStations(from: string, to: string): { from: string; to: string } {
  const trimmedFrom = typeof from === "string" ? from.trim() : "";
  const trimmedTo = typeof to === "string" ? to.trim() : "";
  if (!trimmedFrom || !trimmedTo) {
    throw new ValidationError("A scenic line needs both a From and a To");
  }
  return { from: trimmedFrom, to: trimmedTo };
}

function lineWKT(coordinates: [number, number][]): string {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new ValidationError("A scenic line needs a path of at least two points");
  }
  return coordinatesToWKT(coordinates);
}

const pointWKT = ([lng, lat]: [number, number]) => `POINT(${lng} ${lat})`;

/**
 * The region's scenic lines, by bounding box as the admin routes list is — a
 * line may run through a country outside SUPPORTED_COUNTRIES. Geometry included:
 * there are few of them, and a line picked from the list is flown to at once.
 */
export async function getScenicLines(region: RegionId): Promise<ActionResult<AdminScenicLine[]>> {
  return asAdmin(async () => {
    const result = await pool.query<AdminScenicLineRow>(`
      SELECT id, from_station, to_station, length_km::float8 AS length_km, is_valid, error_message,
             ST_AsGeoJSON(geometry) AS geometry,
             ST_AsGeoJSON(starting_coordinate)::json AS starting_coordinate,
             ST_AsGeoJSON(ending_coordinate)::json AS ending_coordinate
      FROM scenic_lines
      WHERE geometry && ${regionEnvelopeSql(region)}
      ORDER BY from_station, to_station, id
    `);
    return result.rows.map((row) => ({
      ...row,
      starting_coordinate: row.starting_coordinate.coordinates,
      ending_coordinate: row.ending_coordinate.coordinates,
    }));
  });
}

/** Create a scenic line from a previewed path. Returns its id. */
export async function createScenicLine(
  fromStation: string,
  toStation: string,
  coordinates: [number, number][],
  startCoordinate: [number, number],
  endCoordinate: [number, number],
): Promise<ActionResult<number>> {
  return asAdmin(async () => {
    const { from, to } = requiredStations(fromStation, toStation);
    const { startCountry, endCountry } = getRouteCountries({ type: "LineString", coordinates });
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
        lineWKT(coordinates),
        startCountry,
        endCountry,
        pointWKT(startCoordinate),
        pointWKT(endCoordinate),
      ],
    );
    return result.rows[0].id;
  });
}

/** Replace a scenic line's geometry with a re-picked path, which also makes it valid again. */
export async function updateScenicLineGeometry(
  id: number,
  coordinates: [number, number][],
  startCoordinate: [number, number],
  endCoordinate: [number, number],
): Promise<ActionResult<void>> {
  return asAdmin(async () => {
    const { startCountry, endCountry } = getRouteCountries({ type: "LineString", coordinates });
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
        lineWKT(coordinates),
        startCountry,
        endCountry,
        pointWKT(startCoordinate),
        pointWKT(endCoordinate),
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
    const { from, to } = requiredStations(fromStation, toStation);
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
