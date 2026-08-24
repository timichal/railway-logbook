/**
 * User-scoped progress and coverage queries, taking the user id explicitly.
 *
 * A plain server-only module rather than a "use server" one on purpose: every
 * export of a "use server" file becomes a client-callable endpoint, and these
 * take the user id as an argument — exposed, anyone could ask for anyone's
 * numbers. The authenticated wrappers live in `userActions.ts`, and the
 * token-checked ones for a shared public map in `publicMapActions.ts`; both
 * resolve *which* user first and then come here.
 */

import { query } from "./db";
import { REGIONS, type RegionId, regionEnvelopeSql } from "./regions";
import type { CoveredRange, CoveredStretch } from "./types";

/**
 * The user's routes that count as ridden whole, as a subquery on `$1` = user id.
 *
 * The rule lives in the SQL function `user_fully_ridden_routes`
 * (`database/init/02-vector-tiles.sql`) rather than here, so these numbers and
 * the route tile that colours the map can't disagree: a route logged whole, or
 * one whose partial stretches union to the whole line.
 */
const FULLY_RIDDEN_TRACK_IDS = "SELECT track_id FROM user_fully_ridden_routes($1)";

export interface UserProgress {
  totalKm: number;
  completedKm: number;
  percentage: number;
  routePercentage: number;
  totalRoutes: number;
  completedRoutes: number;
}

export async function progressForUser(
  userId: number,
  region: RegionId,
  selectedCountries?: string[],
): Promise<UserProgress> {
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
      AND geometry && ${regionEnvelopeSql(region)}
      ${hasCountries ? "AND start_country = ANY($1::text[]) AND end_country = ANY($1::text[])" : ""}`,
    hasCountries ? [selectedCountries] : [],
  );

  // Get completed distance and count (routes ridden whole, only Regular usage_type=0)
  // "Most permissive wins": a route is complete if any journey logged it whole,
  // or if its partial stretches add up to all of it (FULLY_RIDDEN_TRACK_IDS).
  // The subquery yields distinct ids, so a route counts once however many
  // journeys rode it.
  const completedResult = await query(
    `SELECT
      COALESCE(SUM(rr.length_km), 0) as completed_km,
      COUNT(*) as completed_routes
    FROM railway_routes rr
    WHERE rr.usage_type = 0
      AND rr.length_km IS NOT NULL
      AND rr.geometry && ${regionEnvelopeSql(region)}
      ${hasCountries ? "AND start_country = ANY($2::text[]) AND end_country = ANY($2::text[])" : ""}
      AND rr.track_id IN (${FULLY_RIDDEN_TRACK_IDS})`,
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
export async function progressByCountryForUser(
  userId: number,
  region: RegionId,
): Promise<ProgressByCountry> {
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
       LEFT JOIN (${FULLY_RIDDEN_TRACK_IDS}) done ON done.track_id = rr.track_id
       WHERE rr.usage_type = 0
         AND rr.length_km IS NOT NULL
         AND rr.geometry && ${regionEnvelopeSql(region)}
     )
     SELECT
       GROUPING(country) AS is_total,
       country,
       COALESCE(SUM(length_km), 0) AS total_km,
       COALESCE(SUM(length_km) FILTER (WHERE completed), 0) AS completed_km
     FROM regular
     GROUP BY GROUPING SETS ((country), ())`,
    [userId],
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

  const countryStats: CountryProgress[] = REGIONS[region].countries.map((country) => {
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
export async function buildCoveredStretches(ranges: CoveredRange[]): Promise<CoveredStretch[]> {
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
export function normalizeCoveredRanges(ranges: CoveredRange[]): CoveredRange[] {
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
 * The stretches a user has ridden on routes they haven't completed.
 *
 * Routes ridden whole are left out — including those completed by their
 * stretches adding up (FULLY_RIDDEN_TRACK_IDS): their line is already drawn in
 * the visited colour, so an overlay would add nothing. Stretches from different
 * journeys are returned separately and simply painted over each other — the
 * union comes out right without computing it.
 */
export async function coveredStretchesForUser(userId: number): Promise<CoveredStretch[]> {
  const result = await query(
    `
    SELECT DISTINCT ulp.track_id, ulp.covered_start, ulp.covered_end
    FROM user_logged_parts ulp
    WHERE ulp.user_id = $1
      AND ulp.partial = TRUE
      AND ulp.covered_start IS NOT NULL
      AND ulp.track_id NOT IN (${FULLY_RIDDEN_TRACK_IDS})
    `,
    [userId],
  );

  return buildCoveredStretches(
    result.rows.map((row) => ({
      track_id: row.track_id,
      covered_start: Number(row.covered_start),
      covered_end: Number(row.covered_end),
    })),
  );
}
