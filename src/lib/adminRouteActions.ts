"use server";

import type { PoolClient } from "pg";
import type { ActionResult } from "./actionResult";
import { asAdmin } from "./authHelpers";
import { coordinatesToWKT } from "./coordinateUtils";
import { getRouteCountries } from "./countryUtils";
import pool, { query } from "./db";
import { ValidationError } from "./errors";
import type { LineClass, UsageType } from "./shared/constants";
import { type RegionId, regionEnvelopeSql } from "./shared/regions";
import { MAX_TOLERANCE_FRACTION, UNTRAVELLED_NOISE_KM } from "./shared/routeCoverage";
import type { GeoJSONFeature, GeoJSONFeatureCollection, PathResult } from "./shared/types";
import { getStationsNearRoute, refreshStationProximityFor } from "./stationProximity";

/**
 * The endpoints are required, and so is the name where the region names its
 * lines; the forms say so first, but every export here is an endpoint. Trimmed,
 * because a name of spaces reads as none. `name` is checked only by the caller
 * that knows the region.
 */
function requiredStations(from: string, to: string): { from: string; to: string } {
  const trimmedFrom = typeof from === "string" ? from.trim() : "";
  const trimmedTo = typeof to === "string" ? to.trim() : "";
  if (!trimmedFrom || !trimmedTo) {
    throw new ValidationError("A route needs both a From and a To station");
  }
  return { from: trimmedFrom, to: trimmedTo };
}

/**
 * Interface for route metadata used during creation
 */
export interface SaveRouteData {
  /** Line name, required in regions that name their lines; "" elsewhere. */
  name: string;
  from_station: string;
  to_station: string;
  description: string;
  usage_type: UsageType;
  frequency: string[];
  link: string;
  intended_backtracking: boolean;
}

/** A row of the admin routes list: the route's metadata and flags, no geometry. */
export type AdminRouteSummary = {
  track_id: number;
  /** Line name where the region names its lines, NULL elsewhere. */
  name: string | null;
  from_station: string;
  to_station: string;
  description: string | null;
  usage_type: UsageType;
  line_class: LineClass;
  is_valid: boolean;
  error_message: string | null;
  under_repair: boolean;
  intended_backtracking: boolean;
  has_backtracking: boolean;
};

/**
 * One route as the admin edits it: the list row's fields plus what the edit
 * form, the map focus and the geometry re-pick need.
 */
export type AdminRouteDetail = AdminRouteSummary & {
  frequency: string[];
  link: string | null;
  /** GeoJSON LineString, as a string. */
  geometry: string;
  length_km: number;
  /** The stored click points the route is recalculated from. */
  starting_coordinate: [number, number];
  ending_coordinate: [number, number];
};

/**
 * Get all railway routes of one region (list view, no geometry).
 *
 * Region-filtered by bounding box rather than by country code: the admin can
 * create a route anywhere OSM has track, including countries outside
 * SUPPORTED_COUNTRIES, and those must still show up in the list of the region
 * they were drawn in.
 */
export async function getAllRailwayRoutes(
  region: RegionId,
): Promise<ActionResult<AdminRouteSummary[]>> {
  return asAdmin(async () => {
    const result = await pool.query<AdminRouteSummary>(`
    SELECT track_id, name, from_station, to_station, description, usage_type, line_class,
           is_valid, error_message, under_repair, intended_backtracking, has_backtracking
    FROM railway_routes
    WHERE geometry && ${regionEnvelopeSql(region)}
    ORDER BY from_station, to_station
  `);

    return result.rows;
  });
}

/**
 * Get the total length (km) of the region's valid routes. Powers the admin map
 * km counter, which sits beside a map showing that region alone.
 */
export async function getValidRoutesTotalKm(region: RegionId): Promise<ActionResult<number>> {
  return asAdmin(async () => {
    const result = await query(`
    SELECT COALESCE(SUM(length_km), 0) AS total_km
    FROM railway_routes
    WHERE is_valid = true
      AND geometry && ${regionEnvelopeSql(region)}
  `);

    return Math.round((parseFloat(result.rows[0].total_km) || 0) * 10) / 10;
  });
}

/**
 * Get the distinct set of frequency tags currently in use across all routes.
 * Tags have no separate table: a tag exists exactly as long as some route
 * references it, so dropping the last usage of a tag removes it implicitly.
 * Used to power the tag-label autocomplete in the route editor.
 */
export async function getFrequencyTags(): Promise<ActionResult<string[]>> {
  return asAdmin(async () => {
    const result = await query(`
    SELECT DISTINCT tag
    FROM railway_routes, unnest(frequency) AS tag
    WHERE tag IS NOT NULL AND tag <> ''
    ORDER BY tag
  `);

    return result.rows.map((row) => row.tag as string);
  });
}

type AdminRouteDetailRow = Omit<AdminRouteDetail, "starting_coordinate" | "ending_coordinate"> & {
  starting_coordinate: { coordinates: [number, number] };
  ending_coordinate: { coordinates: [number, number] };
};

/** Get a single railway route by track_id. */
export async function getRailwayRoute(trackId: number): Promise<ActionResult<AdminRouteDetail>> {
  return asAdmin(async () => {
    // length_km is NUMERIC, which pg hands back as a string unless cast.
    const result = await pool.query<AdminRouteDetailRow>(
      `
    SELECT track_id, name, from_station, to_station, description, usage_type, frequency, link, line_class,
           ST_AsGeoJSON(geometry) as geometry, length_km::float8 AS length_km,
           ST_AsGeoJSON(starting_coordinate)::json as starting_coordinate,
           ST_AsGeoJSON(ending_coordinate)::json as ending_coordinate,
           is_valid, error_message, under_repair, intended_backtracking, has_backtracking
    FROM railway_routes
    WHERE track_id = $1
  `,
      [trackId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new ValidationError("Route not found");
    }

    return {
      ...row,
      starting_coordinate: row.starting_coordinate.coordinates,
      ending_coordinate: row.ending_coordinate.coordinates,
    };
  });
}

/**
 * Get the region's route endpoints (starting and ending coordinates) for map
 * display. Returns GeoJSON FeatureCollection of Point features.
 */
export async function getAllRouteEndpoints(
  region: RegionId,
): Promise<ActionResult<GeoJSONFeatureCollection>> {
  return asAdmin(async () => {
    const result = await query(`
    SELECT
      track_id,
      from_station,
      to_station,
      ST_AsGeoJSON(starting_coordinate) as starting_coordinate_json,
      ST_AsGeoJSON(ending_coordinate) as ending_coordinate_json
    FROM railway_routes
    WHERE geometry && ${regionEnvelopeSql(region)}
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
  });
}

/**
 * How close to the new geometry a piece of an old stretch has to run to count
 * as the same track. Both geometries are cut from the same OSM ways, so a ride
 * still on the line is ~0m off it; the slack is for a route whose old geometry
 * predates an OSM realignment. Well under the spacing of two separate lines.
 */
const REPROJECT_CORRIDOR_METERS = 20;

/**
 * Move every partial ride's stretch on a route from its current geometry onto
 * `newGeometryWKT`. Call before the new geometry is written — the current one is
 * read from the row.
 *
 * `covered_start`/`covered_end` are fractions along the geometry they were
 * logged against, so a re-picked geometry leaves them pointing at the wrong
 * track. The case that matters is a split: A–C is duplicated and the two copies
 * re-picked as A–B and B–C, so a ride of A–B only, stored as [0, 0.5], would
 * show the first half of B–C as ridden and A–B as half done.
 *
 * So each stretch is cut out of the old line, and what is kept of it is the
 * pieces that run along the new line (within `REPROJECT_CORRIDOR_METERS`) for at
 * least the tolerance the ridden-whole rule already ignores (see
 * routeCoverage.ts). The pieces' ends are located on the new line and their
 * outermost pair becomes the new range. The length floor is what discards a
 * line merely *crossing* the new one, and the sliver a split leaves at its
 * split point — a hand-picked click that won't sit exactly where the ride's
 * station projected. A stretch with no piece left rode none of the new line:
 * that ride is deleted, since it says the user rode track that is now some
 * other route's.
 *
 * Nothing moves when the geometry is re-saved unchanged. A route that turns
 * back on itself, before or after, has its stretches cleared to unknown extent
 * instead: on doubled track a point lies on both legs, and locating it picks
 * one of them arbitrarily. Whole rides (`partial = FALSE`) and stretches already
 * of unknown extent are untouched. On OSM recalculation (`verifyRouteData`) the
 * fractions are kept as they are: there the geometry only shifts, which is
 * what fractions are for.
 */
async function reprojectCoveredRanges(
  client: PoolClient,
  trackId: number,
  newGeometryWKT: string,
  newHasBacktracking: boolean,
): Promise<void> {
  const result = await client.query<{ moved: string; cleared: string; dropped: string }>(
    `
    WITH route AS (
      SELECT
        rr.geometry AS old_geom,
        ng.geom AS new_geom,
        ST_Buffer(ng.geom::geography, $3)::geometry AS corridor,
        -- The ridden-whole tolerance, in km: UNTRAVELLED_NOISE_KM capped at
        -- MAX_TOLERANCE_FRACTION of the route
        LEAST($4::float8, $5::float8 * ST_Length(ng.geom::geography) / 1000) AS min_km,
        rr.has_backtracking OR rr.intended_backtracking OR $6::boolean AS ambiguous
      FROM railway_routes rr
      CROSS JOIN (SELECT ST_GeomFromText($2, 4326) AS geom) ng
      WHERE rr.track_id = $1
        AND NOT ST_OrderingEquals(rr.geometry, ng.geom)
    ),
    rides AS (
      SELECT ulp.id, ST_LineSubstring(r.old_geom, ulp.covered_start, ulp.covered_end) AS stretch
      FROM user_logged_parts ulp
      CROSS JOIN route r
      WHERE ulp.track_id = $1
        AND ulp.partial
        AND ulp.covered_start IS NOT NULL
        AND ulp.covered_end IS NOT NULL
    ),
    extent AS (
      SELECT
        rides.id,
        MIN(LEAST(loc.a, loc.b)) AS lo,
        MAX(GREATEST(loc.a, loc.b)) AS hi
      FROM rides
      CROSS JOIN route r
      CROSS JOIN LATERAL ST_Dump(ST_Intersection(rides.stretch, r.corridor)) piece
      CROSS JOIN LATERAL (
        SELECT
          ST_LineLocatePoint(r.new_geom, ST_StartPoint(piece.geom)) AS a,
          ST_LineLocatePoint(r.new_geom, ST_EndPoint(piece.geom)) AS b
      ) loc
      WHERE NOT r.ambiguous
        AND ST_GeometryType(piece.geom) = 'ST_LineString'
        AND ST_Length(piece.geom::geography) / 1000 >= r.min_km
      GROUP BY rides.id
    ),
    judged AS (
      SELECT
        rides.id,
        e.lo,
        e.hi,
        CASE
          WHEN r.ambiguous THEN 'clear'
          WHEN e.hi > e.lo THEN 'move'
          ELSE 'delete'
        END AS action
      FROM rides
      CROSS JOIN route r
      LEFT JOIN extent e ON e.id = rides.id
    ),
    dropped AS (
      DELETE FROM user_logged_parts
      WHERE id IN (SELECT id FROM judged WHERE action = 'delete')
      RETURNING id
    ),
    changed AS (
      UPDATE user_logged_parts ulp
      SET
        covered_start = CASE WHEN j.action = 'move' THEN j.lo END,
        covered_end = CASE WHEN j.action = 'move' THEN j.hi END
      FROM judged j
      WHERE ulp.id = j.id AND j.action <> 'delete'
      RETURNING j.action
    )
    SELECT
      count(*) FILTER (WHERE action = 'move') AS moved,
      count(*) FILTER (WHERE action = 'clear') AS cleared,
      (SELECT count(*) FROM dropped) AS dropped
    FROM changed
    `,
    [
      trackId,
      newGeometryWKT,
      REPROJECT_CORRIDOR_METERS,
      UNTRAVELLED_NOISE_KM,
      MAX_TOLERANCE_FRACTION,
      newHasBacktracking,
    ],
  );

  const { moved, cleared, dropped } = result.rows[0];
  if (Number(moved) + Number(cleared) + Number(dropped) > 0) {
    console.log(
      `Route ${trackId}: partial rides moved onto the new geometry ${moved}, cleared to unknown extent ${cleared}, deleted as no longer overlapping ${dropped}`,
    );
  }
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
  trackId?: number,
): Promise<ActionResult<number>> {
  return asAdmin(async () => {
    const client = await pool.connect();
    let brokenConnection: Error | undefined;

    try {
      // The write, the line_class reclassification and the station-proximity
      // refresh are one change: a failure between them would leave the route at
      // the default 'branch', or the user map showing stations no route reaches.
      await client.query("BEGIN");

      // Use the truncated/merged coordinates from pathResult
      // The pathfinder already handles truncation and merging correctly
      const sortedCoordinates = pathResult.coordinates;

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

      let queryStr: string;
      let values: (string | number | string[] | boolean | null)[];

      if (trackId) {
        // Update existing route - only update geometry, length, coordinates, countries, validity, and backtracking flag
        // Keep name, description, usage_type unchanged
        queryStr = `
        UPDATE railway_routes
        SET
          geometry = ST_GeomFromText($1, 4326),
          length_km = ST_Length(ST_GeomFromText($1, 4326)::geography) / 1000,
          start_country = $2,
          end_country = $3,
          starting_coordinate = ST_GeomFromText($4, 4326),
          ending_coordinate = ST_GeomFromText($5, 4326),
          has_backtracking = $6,
          is_valid = TRUE,
          error_message = NULL,
          under_repair = FALSE
        WHERE track_id = $7
        RETURNING track_id
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
        const { from, to } = requiredStations(routeData.from_station, routeData.to_station);
        // Insert new route with auto-generated track_id
        queryStr = `
        INSERT INTO railway_routes (
          name,
          from_station,
          to_station,
          description,
          usage_type,
          frequency,
          link,
          geometry,
          length_km,
          start_country,
          end_country,
          starting_coordinate,
          ending_coordinate,
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
          TRUE,
          $13,
          $14
        )
        RETURNING track_id
      `;

        values = [
          routeData.name.trim() || null,
          from,
          to,
          routeData.description || null,
          routeData.usage_type,
          routeData.frequency || [],
          routeData.link || null,
          geometryWKT,
          startCountry,
          endCountry,
          startPointWKT,
          endPointWKT,
          routeData.intended_backtracking,
          pathResult.hasBacktracking || false,
        ];
      }

      // For an edit, the stations along the route's *current* geometry are collected
      // first: the new geometry may run elsewhere, leaving them without a route
      const stationsOnOldGeometry = trackId ? await getStationsNearRoute(client, trackId) : [];

      // Likewise the partial rides: their fractions are positions along the
      // current geometry, so they are moved onto the new one before it is written
      if (trackId) {
        await reprojectCoveredRanges(
          client,
          trackId,
          geometryWKT,
          pathResult.hasBacktracking || false,
        );
      }

      const result = await client.query(queryStr, values);
      if (result.rowCount === 0) {
        // Only an edit can match nothing: the route was deleted since it was opened
        throw new ValidationError(`Route ${trackId} no longer exists`);
      }
      const savedTrackId = result.rows[0].track_id;

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

      await client.query(classifyLineClassSQL, [savedTrackId]);
      // Stations the user map draws follow the routes, so a new or moved route
      // reveals (or hides) the stations along it right away
      await refreshStationProximityFor(client, {
        trackId: savedTrackId,
        stationIds: stationsOnOldGeometry,
      });

      await client.query("COMMIT");
      console.log(
        `${trackId ? "Updated" : "Saved"} railway route ${savedTrackId}: ${routeData.name.trim() || `${routeData.from_station} ⟷ ${routeData.to_station}`}`,
      );

      return savedTrackId as number;
    } catch (error) {
      // A failed ROLLBACK means the connection itself is gone: keep the original
      // error, and have the pool discard the client (see migrationActions)
      await client.query("ROLLBACK").catch((rollbackError: Error) => {
        brokenConnection = rollbackError;
      });
      // A ValidationError is an answer for the admin, not a fault for the log
      if (!(error instanceof ValidationError)) {
        console.error("Error saving railway route:", error);
      }
      throw error;
    } finally {
      client.release(brokenConnection);
    }
  });
}

/**
 * Update route metadata (line name, endpoints, description, usage_type, etc.)
 * Also marks route as valid since admin is manually validating — which clears
 * `under_repair` too: the flag only ever qualifies an invalid route.
 */
export async function updateRailwayRoute(
  trackId: number,
  name: string | null,
  fromStation: string,
  toStation: string,
  description: string | null,
  usageType: UsageType,
  frequency: string[],
  link: string | null,
  lineClass: LineClass,
  intendedBacktracking: boolean,
): Promise<ActionResult<void>> {
  return asAdmin(async () => {
    const { from, to } = requiredStations(fromStation, toStation);
    const result = await query(
      `
    UPDATE railway_routes
    SET name = $2, from_station = $3, to_station = $4, description = $5, usage_type = $6, frequency = $7,
        link = $8, line_class = $9, intended_backtracking = $10, is_valid = TRUE,
        error_message = NULL, under_repair = FALSE
    WHERE track_id = $1
  `,
      [
        trackId,
        name,
        from,
        to,
        description,
        usageType,
        frequency || [],
        link,
        lineClass,
        intendedBacktracking,
      ],
    );

    // Deleted since it was opened (another tab, a split finished elsewhere)
    if (result.rowCount === 0) {
      throw new ValidationError("Route not found");
    }
  });
}

/**
 * Flag (or unflag) an invalid route as being under repair.
 *
 * An invalid route is either genuinely gone (line dismantled, layout rebuilt) or
 * only temporarily unroutable because the OSM data is mid-works — a bridge being
 * rebuilt, a way split while the survey catches up. This flag separates the
 * second kind so it drops out of the plain "Invalid" worklist and paints violet
 * on the admin map, while still counting as invalid everywhere else.
 *
 * It qualifies invalidity, so it is never set on a valid route and is cleared
 * the moment a route becomes valid again — on geometry re-pick, metadata save
 * and successful recalculation alike.
 */
export async function setRouteUnderRepair(
  trackId: number,
  underRepair: boolean,
): Promise<ActionResult<void>> {
  return asAdmin(async () => {
    const result = await query(
      `
    UPDATE railway_routes
    SET under_repair = $2
    WHERE track_id = $1 AND ($2 = FALSE OR is_valid = FALSE)
  `,
      [trackId, underRepair],
    );

    if (result.rowCount === 0) {
      throw new ValidationError(
        "Route not found, or it is valid and cannot be marked under repair",
      );
    }
  });
}

/**
 * Duplicate a railway route, including its user logs.
 *
 * The copy is an exact clone of the original geometry/metadata, except that
 * "[duplicate]" is appended to the from/to station names so the copy is easy to
 * spot (e.g. "Brno" → "Brno [duplicate]"). All user_logged_parts referencing the
 * original route are cloned to point at the new track_id, preserving each
 * journey's partial flag and ridden stretch — the geometry is identical, so the
 * covered fractions still mean the same thing. Runs in a transaction. Returns the
 * new track_id.
 *
 * Every user's logs are cloned, not just the acting admin's, because duplication
 * is how a route is split: A–C grows a branch at B, so the copy is made and the
 * two are re-pointed at A–B and B–C. Everyone who rode A–C rode both halves, so
 * both copies of their log are correct. A partial ride is carried through the
 * split by the geometry re-pick, which moves its stretch onto each half and
 * deletes it from the half it doesn't reach (`reprojectCoveredRanges`). Finish
 * the split — a duplicate left un-split double-counts.
 */
export async function duplicateRailwayRoute(trackId: number): Promise<ActionResult<number>> {
  return asAdmin(async () => {
    const client = await pool.connect();
    let brokenConnection: Error | undefined;

    try {
      await client.query("BEGIN");

      // Clone the route row (track_id is SERIAL; created_at/updated_at default;
      // the Web Mercator geom columns are repopulated by the INSERT triggers).
      const insertRoute = await client.query(
        `
      INSERT INTO railway_routes (
        name, from_station, to_station, description, usage_type, frequency, link,
        line_class, geometry, length_km, start_country, end_country,
        starting_coordinate, ending_coordinate,
        is_valid, error_message, under_repair, intended_backtracking, has_backtracking
      )
      SELECT
        name, from_station || ' [duplicate]', to_station || ' [duplicate]', description,
        usage_type, frequency, link, line_class, geometry, length_km,
        start_country, end_country, starting_coordinate, ending_coordinate,
        is_valid, error_message, under_repair, intended_backtracking, has_backtracking
      FROM railway_routes
      WHERE track_id = $1
      RETURNING track_id
      `,
        [trackId],
      );

      if (insertRoute.rows.length === 0) {
        throw new ValidationError(`Route with track_id ${trackId} not found`);
      }

      const newTrackId = insertRoute.rows[0].track_id as number;

      // Clone the user logs, remapping track_id to the new route.
      await client.query(
        `
      INSERT INTO user_logged_parts (user_id, journey_id, track_id, partial, covered_start, covered_end, created_at)
      SELECT user_id, journey_id, $2, partial, covered_start, covered_end, created_at
      FROM user_logged_parts
      WHERE track_id = $1
      `,
        [trackId, newTrackId],
      );

      await client.query("COMMIT");

      console.log("Duplicated railway route", trackId, "→", newTrackId);
      return newTrackId;
    } catch (error) {
      // A failed ROLLBACK means the connection itself is gone: keep the original
      // error, and have the pool discard the client (see migrationActions)
      await client.query("ROLLBACK").catch((rollbackError: Error) => {
        brokenConnection = rollbackError;
      });
      // A ValidationError is an answer for the admin, not a fault for the log
      if (!(error instanceof ValidationError)) {
        console.error("Error duplicating railway route:", error);
      }
      throw error;
    } finally {
      client.release(brokenConnection);
    }
  });
}

/**
 * Delete a railway route
 */
export async function deleteRailwayRoute(trackId: number): Promise<ActionResult<void>> {
  return asAdmin(async () => {
    const client = await pool.connect();
    let brokenConnection: Error | undefined;

    try {
      // As in saveRailwayRoute: the delete and the proximity refresh are one
      // change, and the stations it needs can no longer be found afterwards.
      await client.query("BEGIN");

      console.log("Deleting railway route with track_id:", trackId);

      // Collected before the delete — afterwards the geometry is gone and there is
      // no way to find the stations that may have just lost their last route
      const affectedStations = await getStationsNearRoute(client, trackId);

      // Delete from railway_routes table (CASCADE will handle user_trips)
      const deleteQuery = "DELETE FROM railway_routes WHERE track_id = $1";
      const result = await client.query(deleteQuery, [trackId]);

      if (result.rowCount === 0) {
        throw new ValidationError(`Route with track_id ${trackId} not found`);
      }

      await refreshStationProximityFor(client, { stationIds: affectedStations });

      await client.query("COMMIT");

      console.log("Successfully deleted railway route:", trackId);
    } catch (error) {
      // A failed ROLLBACK means the connection itself is gone: keep the original
      // error, and have the pool discard the client (see migrationActions)
      await client.query("ROLLBACK").catch((rollbackError: Error) => {
        brokenConnection = rollbackError;
      });
      // A ValidationError is an answer for the admin, not a fault for the log
      if (!(error instanceof ValidationError)) {
        console.error("Error deleting railway route:", error);
      }
      throw error;
    } finally {
      client.release(brokenConnection);
    }
  });
}
