"use server";

import { RailwayPathFinder } from "../scripts/lib/railwayPathFinder";
import type { ActionResult } from "./actionResult";
import { asAdmin } from "./authHelpers";
import pool from "./db";
import { searchStationsByName } from "./routeQueries";
import type { RegionId } from "./shared/regions";
import type { PathResult, Station } from "./shared/types";

/**
 * Find a path between two coordinates using BFS pathfinding
 * This is the new coordinate-based pathfinding method
 */
export async function findRailwayPathFromCoordinates(
  startCoordinate: [number, number],
  endCoordinate: [number, number],
): Promise<ActionResult<PathResult | null>> {
  return asAdmin(async () => {
    const pathFinder = new RailwayPathFinder();
    return pathFinder.findPathFromCoordinates(pool, startCoordinate, endCoordinate);
  });
}

/**
 * Station name search for the admin map's search box. Every station, not only the
 * `near_route` ones the user map's search offers: the admin map draws them all.
 */
export async function searchAllStations(
  searchQuery: string,
  region: RegionId,
): Promise<ActionResult<Station[]>> {
  return asAdmin(() => searchStationsByName(searchQuery, region, { nearRouteOnly: false }));
}
