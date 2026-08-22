"use server";

import { getUser } from "./authActions";
import { query } from "./db";
import {
  buildCoveredStretches,
  coveredStretchesForUser,
  normalizeCoveredRanges,
  type ProgressByCountry,
  progressByCountryForUser,
  progressForUser,
  type UserProgress,
} from "./progressQueries";
import { type RegionId, regionEnvelopeSql } from "./regions";
import type { CoveredRange, CoveredStretch, RailwayRoute, Station } from "./types";

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
export async function searchStations(searchQuery: string, region: RegionId): Promise<Station[]> {
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
export async function getRegionTrackIds(region: RegionId): Promise<number[]> {
  const result = await query(`
    SELECT track_id
    FROM railway_routes
    WHERE geometry && ${regionEnvelopeSql(region)}
  `);

  return result.rows.map((row) => row.track_id as number);
}

/**
 * Get all railway routes without user-specific data
 * Used for unlogged users to calculate progress stats client-side
 * No authentication required
 */
export async function getAllRoutes(region: RegionId): Promise<RailwayRoute[]> {
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
 * Get metadata (no geometry) for a specific set of routes by track_id.
 * Used by unauthenticated users to label logged parts stored in localStorage,
 * which only retain track_id. No authentication required — route data is public.
 */
export async function getRoutesByIds(trackIds: number[]): Promise<RailwayRoute[]> {
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

/**
 * Progress figures for the logged-in user. The query itself lives in
 * `progressQueries.ts`, shared with the token-checked public-map version.
 */
export async function getUserProgress(
  region: RegionId,
  selectedCountries?: string[],
): Promise<UserProgress> {
  const user = await getUser();
  if (!user) {
    throw new Error("User not authenticated");
  }

  return progressForUser(user.id, region, selectedCountries);
}

/**
 * Get progress statistics broken down by country
 * Returns stats for each country (routes starting AND ending in that country)
 * Plus overall total across all countries
 */
export async function getProgressByCountry(region: RegionId): Promise<ProgressByCountry> {
  const user = await getUser();
  if (!user) {
    throw new Error("User not authenticated");
  }

  return progressByCountryForUser(user.id, region);
}

/**
 * The stretches the logged-in user has ridden on routes they haven't completed.
 */
export async function getCoveredStretches(): Promise<CoveredStretch[]> {
  const user = await getUser();
  if (!user) return [];

  return coveredStretchesForUser(user.id);
}

/**
 * Same as getCoveredStretches, for ranges the caller holds itself — the
 * localStorage journeys of a user who isn't logged in. Route geometry is public
 * (it is served as tiles to everyone), so this needs no authentication; the
 * ranges are validated and capped instead.
 */
export async function getCoveredStretchesFor(ranges: CoveredRange[]): Promise<CoveredStretch[]> {
  return buildCoveredStretches(normalizeCoveredRanges(ranges));
}
