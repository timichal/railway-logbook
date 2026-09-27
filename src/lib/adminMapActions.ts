"use server";

import { RailwayPathFinder } from "../scripts/lib/railwayPathFinder";
import type { ActionResult } from "./actionResult";
import { asAdmin } from "./authHelpers";
import pool from "./db";
import { searchStationsByName } from "./routeQueries";
import type { RegionId } from "./shared/regions";
import type { PathResult, RailwayPart, Station } from "./shared/types";

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
 * Get railway parts by their IDs (used for route creation)
 */
export async function getRailwayPartsByIds(
  partIds: string[],
): Promise<ActionResult<RailwayPart[]>> {
  return asAdmin(async () => {
    if (partIds.length === 0) return [];

    const client = await pool.connect();

    try {
      const placeholders = partIds.map((_, index) => `$${index + 1}`).join(",");
      const queryStr = `
      SELECT
        id,
        ST_AsGeoJSON(geometry) as geometry_json
      FROM railway_parts
      WHERE id IN (${placeholders})
        AND geometry IS NOT NULL
    `;

      const result = await client.query(queryStr, partIds);

      const features: RailwayPart[] = result.rows.map((row) => {
        const geom = JSON.parse(row.geometry_json);
        return {
          type: "Feature" as const,
          geometry: geom,
          properties: {
            "@id": parseInt(row.id, 10),
          },
        } as RailwayPart;
      });

      return features;
    } catch (error) {
      console.error("Error fetching railway parts by IDs:", error);
      throw error;
    } finally {
      client.release();
    }
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
