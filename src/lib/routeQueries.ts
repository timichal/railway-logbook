/**
 * Public route and station reads, with no user in them at all.
 *
 * Route geometry and station names are public — they are served to everyone as
 * tiles — so unlike `progressQueries.ts` these are not withheld for privacy.
 * They live in a plain module for the other reason: a route handler must not
 * import a "use server" action (see MOBILE_APP_PLAN.md, Phase 1), so the query
 * is here and `userActions.ts` is one of its callers.
 */

import { query } from "./db";
import { type RegionId, regionEnvelopeSql } from "./regions";
import type { RailwayRoute, Station } from "./types";

/**
 * Station name search for the user map search box and the Journey Planner.
 *
 * Restricted to `near_route` stations — the same set the user map draws
 * (public_stations_tile), so the autocomplete can't offer a station that isn't
 * on the map and has no route within reach of the planner. The admin map is
 * unaffected; it has its own search and sees every station.
 *
 * Also restricted to the current region: the map is locked to it, so a hit in
 * the other one could neither be flown to nor routed from.
 */
export async function searchStationsByName(
  searchQuery: string,
  region: RegionId,
): Promise<Station[]> {
  if (searchQuery.trim().length < 2) {
    return [];
  }

  const result = await query(
    `
    SELECT id, name,
           ST_X(coordinates) as lon,
           ST_Y(coordinates) as lat
    FROM stations
    WHERE near_route
      AND coordinates && ${regionEnvelopeSql(region)}
      AND unaccent(name) ILIKE unaccent($1)
    ORDER BY
      CASE
        WHEN unaccent(name) ILIKE unaccent($2) THEN 0  -- Exact start match first
        ELSE 1                                          -- Contains match second
      END,
      name
    LIMIT 10
  `,
    [`%${searchQuery}%`, `${searchQuery}%`],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    coordinates: [row.lon, row.lat],
  }));
}

/**
 * The track ids of every route in a region.
 *
 * A few thousand integers, cheap to ship whole, and the only thing the
 * localStorage journey list can use to tell which of its journeys belong to the
 * region on screen: it stores track ids and nothing else, so unlike the
 * database journey list it cannot ask the question in SQL.
 */
export async function trackIdsInRegion(region: RegionId): Promise<number[]> {
  const result = await query(`
    SELECT track_id
    FROM railway_routes
    WHERE geometry && ${regionEnvelopeSql(region)}
  `);

  return result.rows.map((row) => row.track_id as number);
}

/**
 * Every railway route in a region, with geometry and without user-specific
 * data. Used by not-logged-in visitors to work out progress client-side.
 */
export async function routesInRegion(region: RegionId): Promise<RailwayRoute[]> {
  const result = await query(`
    SELECT
      track_id,
      from_station,
      to_station,
      description,
      usage_type,
      frequency,
      link,
      scenic,
      ST_AsGeoJSON(geometry) as geometry,
      length_km,
      start_country,
      end_country
    FROM railway_routes
    WHERE geometry && ${regionEnvelopeSql(region)}
    ORDER BY track_id
  `);

  return result.rows as RailwayRoute[];
}

/**
 * Metadata (no geometry) for a specific set of routes by track_id. Used to
 * label logged parts held in localStorage, which retain only the track id.
 */
export async function routeMetadataByIds(trackIds: number[]): Promise<RailwayRoute[]> {
  if (trackIds.length === 0) return [];

  const result = await query(
    `
    SELECT
      track_id,
      from_station,
      to_station,
      description,
      usage_type,
      frequency,
      link,
      scenic,
      line_class,
      length_km,
      start_country,
      end_country,
      is_valid,
      error_message
    FROM railway_routes
    WHERE track_id = ANY($1::int[])
  `,
    [trackIds],
  );

  return result.rows.map((row) => ({
    ...row,
    geometry: "",
  }));
}
