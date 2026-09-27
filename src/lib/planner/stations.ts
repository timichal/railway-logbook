/**
 * Which routes serve each of a journey's stations, and where along them the
 * station sits.
 */

import pool from "../db";

/** Progressive tolerance levels (meters) for matching routes to a station */
const STATION_TOLERANCES = [100, 500, 1000, 2000, 5000];

/** Everything found near one station, per route serving it. */
export interface StationRouteMatch {
  /** The routes passing near the station. */
  routes: number[];
  /** Fraction along each route where the station sits, by track id. */
  fractions: Map<number, number>;
  /** The point on each route closest to the station, by track id. */
  points: Map<number, [number, number]>;
}

/**
 * Find the routes passing near each of the given stations, by station id.
 *
 * One indexed query covers every station at the widest tolerance; the
 * progressive narrowing then happens in memory. (Querying each tolerance level
 * separately meant up to six sequential scans per station, because
 * `ST_DWithin` on a `::geography` cast cannot use the geometry index.)
 *
 * Per station: the smallest tolerance level that matches anything wins, extended
 * to the next level up to catch nearby routes at slightly different distances
 * (e.g. parallel tracks at the same station).
 *
 * Each match also carries where the station falls along that route, as a 0..1
 * fraction of its geometry: a station is regularly mid-route, and the search
 * charges a terminal route for the stretch between the station and the endpoint
 * it leaves through rather than for the whole line. And the point on the route
 * nearest the station, which is where a journey changing lines at a via gets on
 * or off it (see `changeCosts`). Both are kept for every route within the widest
 * tolerance, not only the matched ones — nothing asks about any other.
 */
export async function findRoutesNearStations(
  stationIds: number[],
): Promise<Map<number, StationRouteMatch>> {
  const matches = new Map<number, StationRouteMatch>();
  for (const stationId of stationIds) {
    matches.set(stationId, { routes: [], fractions: new Map(), points: new Map() });
  }
  if (stationIds.length === 0) return matches;

  const maxTolerance = STATION_TOLERANCES[STATION_TOLERANCES.length - 1];
  const client = await pool.connect();
  try {
    // ST_DWithin against geometry_3857 (indexed) with 1/cos(lat) scaling so the
    // real ground radius matches maxTolerance; exact distance is then measured
    // on the few candidates that survive.
    const rows = await client.query<{
      station_id: string | number;
      track_id: number;
      distance_m: string | number;
      frac: string | number;
      lon: number;
      lat: number;
    }>(
      `
      WITH s AS (
        SELECT id, coordinates, ST_Transform(coordinates, 3857) AS geom_3857
        FROM stations
        WHERE id = ANY($1)
      )
      SELECT
        s.id AS station_id,
        r.track_id,
        ST_Distance(r.geometry::geography, s.coordinates::geography) AS distance_m,
        ST_LineLocatePoint(r.geometry, s.coordinates) AS frac,
        ST_X(ST_ClosestPoint(r.geometry, s.coordinates)) AS lon,
        ST_Y(ST_ClosestPoint(r.geometry, s.coordinates)) AS lat
      FROM s
      JOIN railway_routes r
        ON r.usage_type = 0
       AND ST_DWithin(
             r.geometry_3857,
             s.geom_3857,
             $2 / GREATEST(cos(radians(ST_Y(s.coordinates))), 0.01)
           )
      ORDER BY s.id, distance_m
      `,
      [stationIds, maxTolerance],
    );

    const byStation = new Map<number, { track_id: number; distance: number }[]>();
    for (const row of rows.rows) {
      const stationId = Number(row.station_id);
      const distance =
        typeof row.distance_m === "string" ? parseFloat(row.distance_m) : row.distance_m;
      if (distance > maxTolerance) continue;
      if (!byStation.has(stationId)) byStation.set(stationId, []);
      byStation.get(stationId)!.push({ track_id: row.track_id, distance });
      const match = matches.get(stationId)!;
      match.fractions.set(
        row.track_id,
        typeof row.frac === "string" ? parseFloat(row.frac) : row.frac,
      );
      match.points.set(row.track_id, [Number(row.lon), Number(row.lat)]);
    }

    for (const stationId of stationIds) {
      const candidates = byStation.get(stationId) ?? [];

      for (let i = 0; i < STATION_TOLERANCES.length; i++) {
        if (!candidates.some((c) => c.distance <= STATION_TOLERANCES[i])) continue;
        const cutoff = STATION_TOLERANCES[Math.min(i + 1, STATION_TOLERANCES.length - 1)];
        matches.get(stationId)!.routes = candidates
          .filter((c) => c.distance <= cutoff)
          .map((c) => c.track_id);
        break;
      }
    }

    return matches;
  } finally {
    client.release();
  }
}
