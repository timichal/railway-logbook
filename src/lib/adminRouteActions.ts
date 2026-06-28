"use server";

import { requireAdmin } from "./authHelpers";
import type { LineClass, UsageType } from "./constants";
import { coordinatesToWKT } from "./coordinateUtils";
import { getRouteCountries } from "./countryUtils";
import pool, { query } from "./db";
import type { GeoJSONFeature, GeoJSONFeatureCollection, PathResult } from "./types";

/**
 * Interface for route metadata used during creation
 */
export interface SaveRouteData {
  from_station: string;
  to_station: string;
  description: string;
  usage_type: UsageType;
  frequency: string[];
  link: string;
  scenic: boolean;
  intended_backtracking: boolean;
}

/**
 * Get all railway routes (list view, no geometry)
 */
export async function getAllRailwayRoutes() {
  await requireAdmin();

  const result = await query(`
    SELECT track_id, from_station, to_station, description, usage_type, scenic, line_class,
           starting_part_id, ending_part_id, is_valid, error_message, intended_backtracking, has_backtracking
    FROM railway_routes
    ORDER BY from_station, to_station
  `);

  return result.rows;
}

/**
 * Get the distinct set of frequency tags currently in use across all routes.
 * Tags have no separate table: a tag exists exactly as long as some route
 * references it, so dropping the last usage of a tag removes it implicitly.
 * Used to power the tag-label autocomplete in the route editor.
 */
export async function getFrequencyTags(): Promise<string[]> {
  await requireAdmin();

  const result = await query(`
    SELECT DISTINCT tag
    FROM railway_routes, unnest(frequency) AS tag
    WHERE tag IS NOT NULL AND tag <> ''
    ORDER BY tag
  `);

  return result.rows.map((row) => row.tag as string);
}

/**
 * Get a single railway route by track_id
 */
export async function getRailwayRoute(trackId: string) {
  await requireAdmin();

  const result = await query(
    `
    SELECT track_id, from_station, to_station, description, usage_type, frequency, link, scenic, line_class,
           ST_AsGeoJSON(geometry) as geometry, length_km,
           ST_AsGeoJSON(starting_coordinate) as starting_coordinate_json,
           ST_AsGeoJSON(ending_coordinate) as ending_coordinate_json,
           starting_part_id, ending_part_id, is_valid, error_message, intended_backtracking
    FROM railway_routes
    WHERE track_id = $1
  `,
    [trackId],
  );

  if (result.rows.length === 0) {
    throw new Error("Route not found");
  }

  const row = result.rows[0];

  // Parse coordinate JSON if they exist
  let startingCoordinate = null;
  let endingCoordinate = null;

  if (row.starting_coordinate_json) {
    const geojson = JSON.parse(row.starting_coordinate_json);
    if (geojson.type === "Point" && geojson.coordinates) {
      startingCoordinate = geojson.coordinates as [number, number];
    }
  }

  if (row.ending_coordinate_json) {
    const geojson = JSON.parse(row.ending_coordinate_json);
    if (geojson.type === "Point" && geojson.coordinates) {
      endingCoordinate = geojson.coordinates as [number, number];
    }
  }

  return {
    ...row,
    starting_coordinate: startingCoordinate,
    ending_coordinate: endingCoordinate,
  };
}

/**
 * Get all route endpoints (starting and ending coordinates) for map display
 * Returns GeoJSON FeatureCollection of Point features
 */
export async function getAllRouteEndpoints(): Promise<GeoJSONFeatureCollection> {
  await requireAdmin();

  const result = await query(`
    SELECT
      track_id,
      from_station,
      to_station,
      ST_AsGeoJSON(starting_coordinate) as starting_coordinate_json,
      ST_AsGeoJSON(ending_coordinate) as ending_coordinate_json
    FROM railway_routes
    WHERE starting_coordinate IS NOT NULL AND ending_coordinate IS NOT NULL
  `);

  const features: GeoJSONFeature[] = [];

  for (const row of result.rows) {
    // Parse starting coordinate
    if (row.starting_coordinate_json) {
      const geojson = JSON.parse(row.starting_coordinate_json);
      if (geojson.type === "Point" && geojson.coordinates) {
        features.push({
          type: "Feature" as const,
          geometry: geojson,
          properties: {
            track_id: row.track_id,
            endpoint_type: "start",
            station_name: row.from_station,
            route_name: `${row.from_station} ⟷ ${row.to_station}`,
          },
        });
      }
    }

    // Parse ending coordinate
    if (row.ending_coordinate_json) {
      const geojson = JSON.parse(row.ending_coordinate_json);
      if (geojson.type === "Point" && geojson.coordinates) {
        features.push({
          type: "Feature" as const,
          geometry: geojson,
          properties: {
            track_id: row.track_id,
            endpoint_type: "end",
            station_name: row.to_station,
            route_name: `${row.from_station} ⟷ ${row.to_station}`,
          },
        });
      }
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

/**
 * Create a new route OR update existing route geometry
 * @param trackId - If provided, updates geometry only. If omitted, creates new route.
 * @param startCoordinate - Exact start coordinate [lng, lat]
 * @param endCoordinate - Exact end coordinate [lng, lat]
 */
export async function saveRailwayRoute(
  routeData: SaveRouteData,
  pathResult: PathResult,
  startCoordinate: [number, number],
  endCoordinate: [number, number],
  trackId?: string,
): Promise<string> {
  await requireAdmin();

  const client = await pool.connect();

  try {
    console.log("Saving railway route:", `${routeData.from_station} ⟷ ${routeData.to_station}`);
    console.log("Path segments:", pathResult.partIds.length);
    console.log("Start coordinate:", startCoordinate);
    console.log("End coordinate:", endCoordinate);

    // Use the truncated/merged coordinates from pathResult
    // The pathfinder already handles truncation and merging correctly
    const sortedCoordinates = pathResult.coordinates;
    console.log("Using pathfinder coordinates:", sortedCoordinates.length, "points");

    // Create LineString geometry from coordinates
    const geometryWKT = coordinatesToWKT(sortedCoordinates);

    // Create POINT WKT for start and end coordinates
    const startPointWKT = `POINT(${startCoordinate[0]} ${startCoordinate[1]})`;
    const endPointWKT = `POINT(${endCoordinate[0]} ${endCoordinate[1]})`;

    // Determine countries from route geometry
    const { startCountry, endCountry } = getRouteCountries({
      type: "LineString",
      coordinates: sortedCoordinates,
    });
    console.log("Route countries:", startCountry, "→", endCountry);
    console.log("Has backtracking:", pathResult.hasBacktracking || false);

    let queryStr: string;
    let values: (string | number | string[] | boolean | null)[];

    if (trackId) {
      // Update existing route - only update geometry, length, coordinates, countries, validity, and backtracking flag
      // Keep name, description, usage_type unchanged
      // Set part_id fields to NULL (deprecated)
      queryStr = `
        UPDATE railway_routes
        SET
          geometry = ST_GeomFromText($1, 4326),
          length_km = ST_Length(ST_GeomFromText($1, 4326)::geography) / 1000,
          start_country = $2,
          end_country = $3,
          starting_coordinate = ST_GeomFromText($4, 4326),
          ending_coordinate = ST_GeomFromText($5, 4326),
          starting_part_id = NULL,
          ending_part_id = NULL,
          has_backtracking = $6,
          is_valid = TRUE,
          error_message = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE track_id = $7
        RETURNING track_id, length_km
      `;

      values = [
        geometryWKT,
        startCountry,
        endCountry,
        startPointWKT,
        endPointWKT,
        pathResult.hasBacktracking || false,
        trackId,
      ];
    } else {
      // Insert new route with auto-generated track_id
      // Set part_id fields to NULL (deprecated)
      queryStr = `
        INSERT INTO railway_routes (
          from_station,
          to_station,
          description,
          usage_type,
          frequency,
          link,
          scenic,
          geometry,
          length_km,
          start_country,
          end_country,
          starting_coordinate,
          ending_coordinate,
          starting_part_id,
          ending_part_id,
          is_valid,
          intended_backtracking,
          has_backtracking
        ) VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          ST_GeomFromText($8, 4326),
          ST_Length(ST_GeomFromText($8, 4326)::geography) / 1000,
          $9,
          $10,
          ST_GeomFromText($11, 4326),
          ST_GeomFromText($12, 4326),
          NULL,
          NULL,
          TRUE,
          $13,
          $14
        )
        RETURNING track_id, length_km
      `;

      values = [
        routeData.from_station,
        routeData.to_station,
        routeData.description || null,
        routeData.usage_type,
        routeData.frequency || [],
        routeData.link || null,
        routeData.scenic,
        geometryWKT,
        startCountry,
        endCountry,
        startPointWKT,
        endPointWKT,
        routeData.intended_backtracking,
        pathResult.hasBacktracking || false,
      ];
    }

    const result = await client.query(queryStr, values);
    const savedTrackId = result.rows[0].track_id;
    const lengthKm = result.rows[0].length_km;

    const classifyLineClassSQL = `
      WITH part_lengths AS (
        SELECT
          rp.highspeed,
          rp.usage,
          ST_Length(ST_Intersection(rr.geometry::geography, rp.geometry::geography)) AS len
        FROM railway_routes rr
        JOIN railway_parts rp ON ST_Intersects(rr.geometry, rp.geometry)
        WHERE rr.track_id = $1 AND rp.geometry IS NOT NULL
      ),
      classification AS (
        SELECT
          CASE
            WHEN SUM(CASE WHEN highspeed = TRUE THEN len ELSE 0 END) > SUM(len) * 0.5 THEN 'highspeed'
            WHEN SUM(CASE WHEN usage = 'main' THEN len ELSE 0 END) > SUM(len) * 0.5 THEN 'main'
            ELSE 'branch'
          END AS line_class
        FROM part_lengths
        HAVING SUM(len) > 0
      )
      UPDATE railway_routes
      SET line_class = COALESCE((SELECT line_class FROM classification), 'branch')
      WHERE track_id = $1
    `;

    if (trackId) {
      console.log("Successfully updated railway route geometry:", trackId);
      await client.query(classifyLineClassSQL, [trackId]);
      console.log("Re-classified line_class for route:", trackId);
    } else {
      console.log("Successfully saved railway route with auto-generated track_id:", savedTrackId);
      await client.query(classifyLineClassSQL, [savedTrackId]);
      console.log("Auto-classified line_class for route:", savedTrackId);
    }
    console.log("Final geometry has", sortedCoordinates.length, "coordinate points");
    console.log(
      "Calculated route length:",
      lengthKm ? `${Math.round(lengthKm * 10) / 10} km` : "N/A",
    );
    console.log("Stored coordinates:", startCoordinate, "to", endCoordinate);
    return String(savedTrackId);
  } catch (error) {
    console.error("Error saving railway route:", error);
    throw new Error(
      `Failed to save route: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  } finally {
    client.release();
  }
}

/**
 * Update route metadata (name, description, usage_type, etc.)
 * Also marks route as valid since admin is manually validating
 */
export async function updateRailwayRoute(
  trackId: string,
  fromStation: string,
  toStation: string,
  description: string | null,
  usageType: UsageType,
  frequency: string[],
  link: string | null,
  scenic: boolean,
  lineClass: LineClass,
  intendedBacktracking: boolean,
) {
  await requireAdmin();

  await query(
    `
    UPDATE railway_routes
    SET from_station = $2, to_station = $3, description = $4, usage_type = $5, frequency = $6, link = $7,
        scenic = $8, line_class = $9, intended_backtracking = $10, is_valid = TRUE, error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE track_id = $1
  `,
    [
      trackId,
      fromStation,
      toStation,
      description,
      usageType,
      frequency || [],
      link,
      scenic,
      lineClass,
      intendedBacktracking,
    ],
  );
}

/**
 * Delete a railway route
 */
export async function deleteRailwayRoute(trackId: string): Promise<void> {
  await requireAdmin();

  const client = await pool.connect();

  try {
    console.log("Deleting railway route with track_id:", trackId);

    // Delete from railway_routes table (CASCADE will handle user_trips)
    const deleteQuery = "DELETE FROM railway_routes WHERE track_id = $1";
    const result = await client.query(deleteQuery, [trackId]);

    if (result.rowCount === 0) {
      throw new Error(`Route with track_id ${trackId} not found`);
    }

    console.log("Successfully deleted railway route:", trackId);
  } catch (error) {
    console.error("Error deleting railway route:", error);
    throw new Error(
      `Failed to delete route: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  } finally {
    client.release();
  }
}
