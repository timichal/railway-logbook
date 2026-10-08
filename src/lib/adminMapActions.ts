"use server";

import { RailwayPathFinder } from "../scripts/lib/railwayPathFinder";
import type { ActionResult } from "./actionResult";
import { asAdmin } from "./authHelpers";
import { coordinatesToWKT } from "./coordinateUtils";
import pool from "./db";
import { lineLengthKmSql } from "./lineLength";
import { searchMapByName } from "./routeQueries";
import type { RegionId } from "./shared/regions";
import type { MapSearchResults, PathResult } from "./shared/types";

/**
 * Find a path between two coordinates using BFS pathfinding — the admin's route
 * and scenic line preview.
 *
 * `lengthKm` is measured by PostGIS with the expression a save stores
 * (`lineLengthKmSql`), so the preview shows the length the route will have.
 * A path of fewer than two points is no line to measure — PostGIS would throw
 * and take the preview down with it — so it comes back with no length.
 */
export async function findRailwayPathFromCoordinates(
  startCoordinate: [number, number],
  endCoordinate: [number, number],
): Promise<ActionResult<(PathResult & { lengthKm: number | null }) | null>> {
  return asAdmin(async () => {
    const pathFinder = new RailwayPathFinder();
    const path = await pathFinder.findPathFromCoordinates(pool, startCoordinate, endCoordinate);
    if (!path) return null;
    if (path.coordinates.length < 2) return { ...path, lengthKm: null };
    const result = await pool.query<{ length_km: number }>(
      `SELECT ${lineLengthKmSql("$1")} AS length_km`,
      [coordinatesToWKT(path.coordinates)],
    );
    return { ...path, lengthKm: result.rows[0].length_km };
  });
}

/**
 * The admin map's search box. Every station, not only the `near_route` ones the
 * user map's search offers: the admin map draws them all. Lines as on the user map.
 */
export async function searchAdminMap(
  searchQuery: string,
  region: RegionId,
): Promise<ActionResult<MapSearchResults>> {
  return asAdmin(() => searchMapByName(searchQuery, region, { nearRouteOnly: false }));
}
