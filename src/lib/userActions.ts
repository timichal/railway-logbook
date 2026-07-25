"use server";

import { getUser } from "./authActions";
import { SUPPORTED_COUNTRIES } from "./constants";
import { query } from "./db";
import type { RailwayRoute, Station } from "./types";

export async function searchStations(searchQuery: string): Promise<Station[]> {
  if (searchQuery.trim().length < 2) {
    return [];
  }

  const result = await query(
    `
    SELECT id, name,
           ST_X(coordinates) as lon,
           ST_Y(coordinates) as lat
    FROM stations
    WHERE unaccent(name) ILIKE unaccent($1)
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
 * Get all railway routes without user-specific data
 * Used for unlogged users to calculate progress stats client-side
 * No authentication required
 */
export async function getAllRoutes(): Promise<RailwayRoute[]> {
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

export interface UserProgress {
  totalKm: number;
  completedKm: number;
  percentage: number;
  routePercentage: number;
  totalRoutes: number;
  completedRoutes: number;
}

export async function getUserProgress(selectedCountries?: string[]): Promise<UserProgress> {
  const user = await getUser();
  if (!user) {
    throw new Error("User not authenticated");
  }

  const userId = user.id;

  // If selectedCountries is provided (even if empty), apply filtering
  // undefined = no filter (show all), [] = empty filter (show nothing), [...] = specific countries
  const applyCountryFilter = selectedCountries !== undefined;
  const hasCountries = selectedCountries && selectedCountries.length > 0;

  // If empty array, return zeros immediately
  if (applyCountryFilter && !hasCountries) {
    return {
      totalKm: 0,
      completedKm: 0,
      percentage: 0,
      routePercentage: 0,
      totalRoutes: 0,
      completedRoutes: 0,
    };
  }

  // Get total distance and count of all routes (only Regular usage_type=0 counts; Heritage & Special excluded, optionally filtered by countries)
  const totalResult = await query(
    `SELECT
      COALESCE(SUM(length_km), 0) as total_km,
      COUNT(*) as total_routes
    FROM railway_routes
    WHERE length_km IS NOT NULL
      AND usage_type = 0
      ${hasCountries ? "AND start_country = ANY($1::text[]) AND end_country = ANY($1::text[])" : ""}`,
    hasCountries ? [selectedCountries] : [],
  );

  // Get completed distance and count (routes with at least one complete journey, only Regular usage_type=0)
  // "Most permissive wins": Route is complete if it's complete in ANY journey
  // Use EXISTS to ensure each route is only counted once regardless of number of journeys
  const completedResult = await query(
    `SELECT
      COALESCE(SUM(rr.length_km), 0) as completed_km,
      COUNT(*) as completed_routes
    FROM railway_routes rr
    WHERE rr.usage_type = 0
      AND rr.length_km IS NOT NULL
      ${hasCountries ? "AND start_country = ANY($2::text[]) AND end_country = ANY($2::text[])" : ""}
      AND EXISTS (
        SELECT 1
        FROM user_logged_parts
        WHERE track_id = rr.track_id
          AND user_id = $1
          AND partial = FALSE
          AND track_id IS NOT NULL
      )`,
    hasCountries ? [userId, selectedCountries] : [userId],
  );

  const totalKm = parseFloat(totalResult.rows[0].total_km) || 0;
  const completedKm = parseFloat(completedResult.rows[0].completed_km) || 0;
  const totalRoutes = parseInt(totalResult.rows[0].total_routes, 10) || 0;
  const completedRoutes = parseInt(completedResult.rows[0].completed_routes, 10) || 0;

  const percentage = totalKm > 0 ? (completedKm / totalKm) * 100 : 0;
  const routePercentage = totalRoutes > 0 ? (completedRoutes / totalRoutes) * 100 : 0;

  return {
    totalKm: Math.round(totalKm * 10) / 10,
    completedKm: Math.round(completedKm * 10) / 10,
    percentage: Math.round(percentage),
    routePercentage: Math.round(routePercentage),
    totalRoutes,
    completedRoutes,
  };
}

export interface CountryProgress {
  countryCode: string;
  countryName: string;
  totalKm: number;
  completedKm: number;
}

export interface ProgressByCountry {
  byCountry: CountryProgress[];
  total: {
    totalKm: number;
    completedKm: number;
  };
}

/**
 * Get progress statistics broken down by country
 * Returns stats for each country (routes starting AND ending in that country)
 * Plus overall total across all countries
 */
export async function getProgressByCountry(): Promise<ProgressByCountry> {
  const user = await getUser();
  if (!user) {
    throw new Error("User not authenticated");
  }

  // One pass over the Regular routes, aggregated twice via GROUPING SETS:
  // - per `country` (non-NULL only for routes that both start and end in the
  //   same country — cross-border routes land in the NULL bucket and are ignored)
  // - the grand total over every Regular route, cross-border included
  // `is_total` (GROUPING) tells the two NULL-country rows apart.
  const result = await query(
    `WITH regular AS (
       SELECT
         rr.length_km,
         CASE WHEN rr.start_country = rr.end_country THEN rr.start_country END AS country,
         (done.track_id IS NOT NULL) AS completed
       FROM railway_routes rr
       LEFT JOIN (
         SELECT DISTINCT track_id
         FROM user_logged_parts
         WHERE user_id = $1 AND partial = FALSE AND track_id IS NOT NULL
       ) done ON done.track_id = rr.track_id
       WHERE rr.usage_type = 0
         AND rr.length_km IS NOT NULL
     )
     SELECT
       GROUPING(country) AS is_total,
       country,
       COALESCE(SUM(length_km), 0) AS total_km,
       COALESCE(SUM(length_km) FILTER (WHERE completed), 0) AS completed_km
     FROM regular
     GROUP BY GROUPING SETS ((country), ())`,
    [user.id],
  );

  const round1 = (value: number) => Math.round(value * 10) / 10;

  const byCode = new Map<string, { totalKm: number; completedKm: number }>();
  let overallTotalKm = 0;
  let overallCompletedKm = 0;

  for (const row of result.rows) {
    const totalKm = parseFloat(row.total_km) || 0;
    const completedKm = parseFloat(row.completed_km) || 0;

    if (row.is_total === 1) {
      overallTotalKm = totalKm;
      overallCompletedKm = completedKm;
    } else if (row.country) {
      byCode.set(row.country, { totalKm, completedKm });
    }
  }

  const countryStats: CountryProgress[] = SUPPORTED_COUNTRIES.map((country) => {
    const stats = byCode.get(country.code);
    return {
      countryCode: country.code,
      countryName: country.name,
      totalKm: round1(stats?.totalKm ?? 0),
      completedKm: round1(stats?.completedKm ?? 0),
    };
  });

  return {
    byCountry: countryStats,
    total: {
      totalKm: round1(overallTotalKm),
      completedKm: round1(overallCompletedKm),
    },
  };
}
