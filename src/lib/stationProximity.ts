/**
 * `stations.near_route` marks the stations that have an admin-defined route
 * running within STATION_ROUTE_PROXIMITY_METERS. Only those are served to the
 * user map (`public_stations_tile`) and offered by `searchStations`: OSM holds
 * far more station points than the network we map, and one with no route beside
 * it is noise — nothing to click, nothing for the planner to reach. The admin
 * map still sees every station (`stations_tile`), which is what route creation
 * needs.
 *
 * The flag is derived, so it has to be refreshed whenever route geometry moves:
 * fully after a bulk recalculation (import, verifyRouteData), and per-route on
 * admin writes.
 */
import type { ClientBase } from "pg";
import { withinMetersSql } from "./mercatorDistance";

/** How close a route has to run for a station to show on the user map. */
export const STATION_ROUTE_PROXIMITY_METERS = 250;

/** TRUE when any route runs within range of station `s`. */
const NEAR_ROUTE_EXISTS = `
  EXISTS (
    SELECT 1
    FROM railway_routes r
    WHERE r.geometry_3857 IS NOT NULL
      AND ${withinMetersSql("r.geometry_3857", "s.coordinates_3857", STATION_ROUTE_PROXIMITY_METERS, "ST_Y(s.coordinates)")}
  )`;

/**
 * Set `near_route` afresh on the stations `stationFilter` picks (a condition on
 * `s`), writing only the rows whose flag actually changes.
 *
 * Rewriting every row, as a bare `UPDATE … SET near_route = EXISTS …` does, costs
 * a new tuple per station per import even when nothing moved — and not a HOT one,
 * since the column is in the predicate of the tile's partial index.
 *
 * The flag is a NOT NULL boolean, so a row that differs from the check can only
 * be flipped — which is what lets the check sit in the `WHERE` alone and run
 * once per station. Written as `SET near_route = EXISTS … WHERE near_route IS
 * DISTINCT FROM EXISTS …`, every changed row would pay for it twice.
 */
function updateNearRouteSql(stationFilter: string): string {
  return `
    UPDATE stations s
    SET near_route = NOT s.near_route
    WHERE (${stationFilter})
      AND s.near_route IS DISTINCT FROM ${NEAR_ROUTE_EXISTS}`;
}

export interface ProximityCounts {
  near: number;
  total: number;
}

/**
 * Recompute `near_route` for every station. Cheap enough to run wholesale
 * (~5k routes in the index), unlike the per-route refresh, which exists to keep
 * an admin's edit from waiting on it.
 */
export async function refreshAllStationProximity(db: ClientBase): Promise<ProximityCounts> {
  await db.query(updateNearRouteSql("TRUE"));

  const { rows } = await db.query<{ near: string; total: string }>(
    `SELECT count(*) FILTER (WHERE near_route) AS near, count(*) AS total FROM stations`,
  );

  return { near: Number(rows[0].near), total: Number(rows[0].total) };
}

/**
 * The stations currently in range of one route. Call this *before* a write that
 * moves or removes the route's geometry: those stations may lose their last
 * route, and once the geometry is gone there is no way to find them.
 */
export async function getStationsNearRoute(db: ClientBase, trackId: number): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `
    SELECT s.id
    FROM stations s
    JOIN railway_routes r ON r.track_id = $1
    WHERE r.geometry_3857 IS NOT NULL
      AND ${withinMetersSql("r.geometry_3857", "s.coordinates_3857", STATION_ROUTE_PROXIMITY_METERS, "ST_Y(s.coordinates)")}
    `,
    [trackId],
  );

  return rows.map((row) => String(row.id));
}

/**
 * Recompute `near_route` for the stations affected by a single route write:
 * those in range of the route as it stands now (`trackId`, omitted when it was
 * deleted) plus any handed over from getStationsNearRoute before the write.
 */
export async function refreshStationProximityFor(
  db: ClientBase,
  { trackId, stationIds = [] }: { trackId?: number; stationIds?: string[] },
): Promise<void> {
  if (trackId === undefined && stationIds.length === 0) return;

  await db.query(
    updateNearRouteSql(`
      s.id = ANY($1::bigint[])
      OR EXISTS (
        SELECT 1
        FROM railway_routes r
        WHERE r.track_id = $2
          AND r.geometry_3857 IS NOT NULL
          AND ${withinMetersSql("r.geometry_3857", "s.coordinates_3857", STATION_ROUTE_PROXIMITY_METERS, "ST_Y(s.coordinates)")}
      )`),
    [stationIds, trackId ?? null],
  );
}
