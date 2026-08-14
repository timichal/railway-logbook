"use server";

import { getUser } from "./authActions";
import { SUPPORTED_COUNTRIES } from "./constants";
import { query } from "./db";
import type { CoveredRange, CoveredStretch, RailwayRoute, Station } from "./types";

/**
 * Station name search for the user map search box and the Journey Planner.
 *
 * Restricted to `near_railway` stations — the same set the user map draws
 * (public_stations_tile), so the autocomplete can't offer a station that isn't
 * on the map and has no route within reach of the planner. The admin map is
 * unaffected; it has its own search and sees every station.
 */
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
    WHERE near_railway
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

/** Cap on ranges accepted from the client, so a crafted call can't ask for the world. */
const MAX_COVERED_RANGES = 2000;

/**
 * Resolve covered fraction ranges into drawable geometry.
 *
 * The stored form is fractions along the route (see CoveredRange), so the
 * geometry is cut on read — which means it follows the route through an OSM
 * update instead of going stale.
 */
async function buildCoveredStretches(ranges: CoveredRange[]): Promise<CoveredStretch[]> {
  if (ranges.length === 0) return [];

  const result = await query(
    `
    SELECT
      t.track_id,
      t.covered_start,
      t.covered_end,
      rr.line_class,
      rr.usage_type,
      rr.start_country,
      rr.end_country,
      -- Not simplified: this is drawn directly over the route's own line, and any
      -- dropped vertex shows up as the overlay visibly cutting corners at zoom.
      ST_AsGeoJSON(ST_LineSubstring(rr.geometry, t.covered_start, t.covered_end)) AS geojson
    FROM unnest($1::int[], $2::float8[], $3::float8[]) AS t(track_id, covered_start, covered_end)
    JOIN railway_routes rr ON rr.track_id = t.track_id
    WHERE rr.geometry IS NOT NULL
    `,
    [
      ranges.map((r) => r.track_id),
      ranges.map((r) => r.covered_start),
      ranges.map((r) => r.covered_end),
    ],
  );

  const stretches: CoveredStretch[] = [];
  for (const row of result.rows) {
    const parsed = JSON.parse(row.geojson) as { coordinates: [number, number][] };
    if (!parsed.coordinates || parsed.coordinates.length < 2) continue;
    stretches.push({
      track_id: row.track_id,
      covered_start: Number(row.covered_start),
      covered_end: Number(row.covered_end),
      line_class: row.line_class,
      usage_type: row.usage_type,
      start_country: row.start_country,
      end_country: row.end_country,
      coordinates: parsed.coordinates,
    });
  }
  return stretches;
}

/** Keep only well-formed, non-degenerate ranges, deduplicated. */
function normalizeCoveredRanges(ranges: CoveredRange[]): CoveredRange[] {
  const seen = new Set<string>();
  const valid: CoveredRange[] = [];

  for (const range of ranges) {
    const trackId = Number(range?.track_id);
    const start = Number(range?.covered_start);
    const end = Number(range?.covered_end);
    if (!Number.isInteger(trackId)) continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0 || end > 1 || start >= end) continue;

    const key = `${trackId}:${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({ track_id: trackId, covered_start: start, covered_end: end });
    if (valid.length >= MAX_COVERED_RANGES) break;
  }

  return valid;
}

/**
 * The stretches the logged-in user has ridden on routes they haven't completed.
 *
 * Routes completed in some journey are left out: their line is already drawn in
 * the visited colour, so an overlay would add nothing. Stretches from different
 * journeys are returned separately and simply painted over each other — the
 * union comes out right without computing it.
 */
export async function getCoveredStretches(): Promise<CoveredStretch[]> {
  const user = await getUser();
  if (!user) return [];

  const result = await query(
    `
    SELECT DISTINCT ulp.track_id, ulp.covered_start, ulp.covered_end
    FROM user_logged_parts ulp
    WHERE ulp.user_id = $1
      AND ulp.partial = TRUE
      AND ulp.covered_start IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM user_logged_parts done
        WHERE done.user_id = ulp.user_id
          AND done.track_id = ulp.track_id
          AND done.partial = FALSE
      )
    `,
    [user.id],
  );

  return buildCoveredStretches(
    result.rows.map((row) => ({
      track_id: row.track_id,
      covered_start: Number(row.covered_start),
      covered_end: Number(row.covered_end),
    })),
  );
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
