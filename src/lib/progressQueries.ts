/**
 * User-scoped progress, ride and coverage queries, taking the user id explicitly.
 *
 * A plain server-only module rather than a "use server" one on purpose: every
 * export of a "use server" file becomes a client-callable endpoint, and these
 * take the user id as an argument — exposed, anyone could ask for anyone's
 * numbers. The session's wrappers are the `api/me` handlers, and the
 * token-checked ones for a shared public map the `api/shared` handlers (through
 * `publicMapQueries.ts`); both resolve *which* user first and then come here.
 */

import pool from "./db";
import type { UsageType } from "./shared/constants";
import type { RouteRide } from "./shared/map/routeRides";
import {
  type CountryProgress,
  EMPTY_PROGRESS,
  type ProgressByCountry,
  round1,
  toUserProgress,
  type UsageProgress,
  type UserProgress,
} from "./shared/progress";
import {
  countedUsageTypes,
  ordinaryUsageSql,
  REGIONS,
  type RegionId,
  regionContainsSql,
} from "./shared/regions";
import type { CoveredRange, CoveredStretch } from "./shared/types";

/**
 * The user's routes that count as ridden whole, as a subquery on `$1` = user id.
 *
 * The rule lives in the SQL function `user_fully_ridden_routes`
 * (`database/init/02-vector-tiles.sql`) rather than here, so these numbers and
 * the map's colours (`routeRidesForUser`) can't disagree: a route logged whole, or
 * one whose partial stretches union to the whole line.
 */
const FULLY_RIDDEN_TRACK_IDS = "SELECT track_id FROM user_fully_ridden_routes($1)";

/**
 * The user's km and route counts (`progressForUser`), or with a null user, who has
 * ridden nothing, the network's totals alone (`networkProgress`). Private, so a
 * caller holding a user id that may be null can't reach the second by mistake
 * and show a user 0% ridden.
 */
async function progressFor(
  userId: number | null,
  region: RegionId,
  selectedCountries?: string[],
  /**
   * The usage types shown on the map, to narrow the count to (`countedUsageTypes`);
   * undefined counts every type the region counts.
   */
  shownUsageTypes?: readonly unknown[],
): Promise<UserProgress> {
  // If selectedCountries is provided (even if empty), apply filtering
  // undefined = no filter (show all), [] = empty filter (show nothing), [...] = specific countries
  const applyCountryFilter = selectedCountries !== undefined;
  const hasCountries = selectedCountries && selectedCountries.length > 0;

  // If empty array, return zeros immediately - and the same where every usage
  // type counted here has been switched off
  if (
    (applyCountryFilter && !hasCountries) ||
    countedUsageTypes(region, shownUsageTypes).length === 0
  ) {
    return EMPTY_PROGRESS;
  }

  // Total distance and count of all routes the region counts as ordinary service
  // (Regular, plus Japan's non-JR lines — see `ordinaryUsageTypes`) and the map
  // shows, optionally filtered by countries, and of those the ones ridden whole.
  // Never a closed route: progress is against the network as it runs today, so a
  // ride on a closed line counts in neither the total nor the ridden figure (here
  // and in the dataAccess twin).
  // "Most permissive wins": a route is complete if any journey logged it whole,
  // or if its partial stretches add up to all of it (FULLY_RIDDEN_TRACK_IDS).
  // That subquery yields distinct ids, so the join keeps one row per route
  // however many journeys rode it.
  const result = await pool.query<{
    total_km: number;
    total_routes: number;
    completed_km: number;
    completed_routes: number;
  }>(
    `SELECT
      COALESCE(SUM(rr.length_km), 0) AS total_km,
      COUNT(*)::int AS total_routes,
      COALESCE(SUM(rr.length_km) FILTER (WHERE done.track_id IS NOT NULL), 0) AS completed_km,
      (COUNT(*) FILTER (WHERE done.track_id IS NOT NULL))::int AS completed_routes
    FROM railway_routes rr
    LEFT JOIN (${FULLY_RIDDEN_TRACK_IDS}) done ON done.track_id = rr.track_id
    WHERE rr.length_km IS NOT NULL
      AND NOT rr.closed
      AND ${ordinaryUsageSql(region, "rr.usage_type", shownUsageTypes)}
      AND ${regionContainsSql(region, "rr.starting_coordinate")}
      ${hasCountries ? "AND rr.start_country = ANY($2::text[]) AND rr.end_country = ANY($2::text[])" : ""}`,
    hasCountries ? [userId, selectedCountries] : [userId],
  );

  const {
    total_km: totalKm,
    total_routes: totalRoutes,
    completed_km: completedKm,
    completed_routes: completedRoutes,
  } = result.rows[0];
  return toUserProgress({ totalKm, completedKm, totalRoutes, completedRoutes });
}

export function progressForUser(
  userId: number,
  region: RegionId,
  selectedCountries?: string[],
  shownUsageTypes?: readonly unknown[],
): Promise<UserProgress> {
  return progressFor(userId, region, selectedCountries, shownUsageTypes);
}

/**
 * The network's km and route counts with nothing ridden: a logged-out visitor's
 * progress box while their local log is empty (`api/public/progress`).
 */
export function networkProgress(
  region: RegionId,
  selectedCountries?: string[],
  shownUsageTypes?: readonly unknown[],
): Promise<UserProgress> {
  return progressFor(null, region, selectedCountries, shownUsageTypes);
}

/**
 * Get progress statistics broken down by country and by usage type
 * Returns stats for each country (routes starting AND ending in that country),
 * for each usage type the region counts, plus the overall total. A null user is
 * the network's totals alone, as in progressFor.
 */
async function progressByCountryFor(
  userId: number | null,
  region: RegionId,
): Promise<ProgressByCountry> {
  // One pass over the routes the region counts as ordinary service, aggregated
  // three times via GROUPING SETS:
  // - per `country` (non-NULL only for routes that both start and end in the
  //   same country — cross-border routes land in the NULL bucket and are ignored)
  // - per `usage_type` (Japan's JR and non-JR lines), cross-border included
  // - the grand total over every counted route, cross-border included
  // GROUPING tells the sets apart: bit 1 is `country` rolled up, bit 0 `usage_type`.
  const result = await pool.query<{
    grouping: number;
    country: string | null;
    usage_type: UsageType | null;
    total_km: number;
    completed_km: number;
  }>(
    `WITH counted AS (
       SELECT
         rr.length_km,
         rr.usage_type,
         CASE WHEN rr.start_country = rr.end_country THEN rr.start_country END AS country,
         (done.track_id IS NOT NULL) AS completed
       FROM railway_routes rr
       LEFT JOIN (${FULLY_RIDDEN_TRACK_IDS}) done ON done.track_id = rr.track_id
       WHERE ${ordinaryUsageSql(region, "rr.usage_type")}
         AND NOT rr.closed
         AND rr.length_km IS NOT NULL
         AND ${regionContainsSql(region, "rr.starting_coordinate")}
     )
     SELECT
       GROUPING(country, usage_type) AS grouping,
       country,
       usage_type,
       COALESCE(SUM(length_km), 0) AS total_km,
       COALESCE(SUM(length_km) FILTER (WHERE completed), 0) AS completed_km
     FROM counted
     GROUP BY GROUPING SETS ((country), (usage_type), ())`,
    [userId],
  );

  const byCode = new Map<string, { totalKm: number; completedKm: number }>();
  const byType = new Map<number, { totalKm: number; completedKm: number }>();
  let overallTotalKm = 0;
  let overallCompletedKm = 0;

  for (const row of result.rows) {
    const { total_km: totalKm, completed_km: completedKm } = row;

    // GROUPING comes back as an int: 3 = grand total, 2 = per usage type
    // (country rolled up), 1 = per country (usage type rolled up)
    if (row.grouping === 3) {
      overallTotalKm = totalKm;
      overallCompletedKm = completedKm;
    } else if (row.grouping === 2 && row.usage_type !== null) {
      byType.set(row.usage_type, { totalKm, completedKm });
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

  const usageStats: UsageProgress[] = REGIONS[region].ordinaryUsageTypes.map((usageType) => {
    const stats = byType.get(usageType);
    return {
      usageType,
      totalKm: round1(stats?.totalKm ?? 0),
      completedKm: round1(stats?.completedKm ?? 0),
    };
  });

  return {
    byCountry: countryStats,
    byUsage: usageStats,
    total: {
      totalKm: round1(overallTotalKm),
      completedKm: round1(overallCompletedKm),
    },
  };
}

export function progressByCountryForUser(
  userId: number,
  region: RegionId,
): Promise<ProgressByCountry> {
  return progressByCountryFor(userId, region);
}

/** As networkProgress, per country and usage type (Map & Stats). */
export function networkProgressByCountry(region: RegionId): Promise<ProgressByCountry> {
  return progressByCountryFor(null, region);
}

/**
 * Whether the logged part `ulp` carries the stretch it covered: exactly the partial
 * rides (`logged_parts_partial_has_stretch`). A whole ride counts the route's full
 * length — the same rule the Route Logger's total follows (`loggedLengthKm`), and
 * the test `knownStretches` makes in JS.
 */
export const HAS_STRETCH_SQL =
  "ulp.partial AND ulp.covered_start IS NOT NULL AND ulp.covered_end IS NOT NULL";

/** Cap on ranges accepted from the client, so a crafted call can't ask for the world. */
const MAX_COVERED_RANGES = 2000;
/** Postgres `int`, which track ids are cast to: a larger id would fail the query. */
export const MAX_PG_INT = 2147483647;

/**
 * Covered fraction ranges cut into drawable geometry, as a SELECT over `ranges` — a
 * FROM item with the columns `track_id`, `covered_start`, `covered_end` (float8),
 * aliased `t`. Read the rows with `parseCoveredStretches`.
 *
 * The stored form is fractions along the route (see CoveredRange), so the
 * geometry is cut on read — which means it follows the route through an OSM
 * update instead of going stale.
 */
export function coveredStretchesSql(ranges: string): string {
  return `
    SELECT
      t.track_id,
      t.covered_start,
      t.covered_end,
      rr.line_class,
      rr.usage_type,
      rr.closed,
      rr.start_country,
      rr.end_country,
      ${coveredStretchGeoJsonSql("rr.geometry", "t.covered_start", "t.covered_end")} AS geojson
    FROM ${ranges}
    JOIN railway_routes rr ON rr.track_id = t.track_id`;
}

/**
 * The stretch of `geometry` between two fractions along it, as GeoJSON text, as
 * `coveredStretchesSql` cuts it — for a read that has the route already joined.
 *
 * Not simplified: this is drawn directly over the route's own line, and any
 * dropped vertex shows up as the overlay visibly cutting corners at zoom.
 */
export function coveredStretchGeoJsonSql(geometry: string, start: string, end: string): string {
  return `ST_AsGeoJSON(ST_LineSubstring(${geometry}, ${start}, ${end}))`;
}

export type CoveredStretchRow = Omit<CoveredStretch, "coordinates"> & { geojson: string };

export function parseCoveredStretches(rows: CoveredStretchRow[]): CoveredStretch[] {
  const stretches: CoveredStretch[] = [];
  for (const { geojson, ...row } of rows) {
    const parsed = JSON.parse(geojson) as { coordinates: [number, number][] };
    if (!parsed.coordinates || parsed.coordinates.length < 2) continue;
    stretches.push({ ...row, coordinates: parsed.coordinates });
  }
  return stretches;
}

/** Resolve covered fraction ranges into drawable geometry (see coveredStretchesSql). */
export async function buildCoveredStretches(ranges: CoveredRange[]): Promise<CoveredStretch[]> {
  if (ranges.length === 0) return [];

  const result = await pool.query<CoveredStretchRow>(
    coveredStretchesSql(
      "unnest($1::int[], $2::float8[], $3::float8[]) AS t(track_id, covered_start, covered_end)",
    ),
    [
      ranges.map((r) => r.track_id),
      ranges.map((r) => r.covered_start),
      ranges.map((r) => r.covered_end),
    ],
  );
  return parseCoveredStretches(result.rows);
}

/** Keep only well-formed, non-degenerate ranges, deduplicated. */
export function normalizeCoveredRanges(ranges: CoveredRange[]): CoveredRange[] {
  const seen = new Set<string>();
  const valid: CoveredRange[] = [];

  for (const range of ranges) {
    const trackId = Number(range?.track_id);
    const start = Number(range?.covered_start);
    const end = Number(range?.covered_end);
    // Bounded to Postgres `int`, which the ids are cast to: a larger one is not a
    // route, and would fail the whole query rather than just match nothing
    if (!Number.isInteger(trackId) || trackId <= 0 || trackId > MAX_PG_INT) continue;
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
 * Every route a user has ridden, for the map to colour (`RouteRide`, see
 * `shared/map/routeRides.ts`): whether ridden whole, whether closed, and the most
 * recent journey over it.
 *
 * The most recent journey is the latest by date, then the latest logged, as the
 * route tile used to pick it. "Whole" is `user_fully_ridden_routes`, as progress
 * reads it.
 *
 * `region` as for `coveredStretchesForUser`: the web map asks for its region's,
 * the mobile API (`null`) for every region's, which its country filter separates.
 * About 3ms and 1,400 rows for the heaviest user (2026-11-15).
 */
export async function routeRidesForUser(
  userId: number,
  region: RegionId | null,
): Promise<RouteRide[]> {
  const result = await pool.query<RouteRide>(
    `
    SELECT latest.track_id,
           (ridden.track_id IS NOT NULL) AS whole,
           rr.closed,
           latest.date,
           latest.journey_name
    FROM (
      SELECT DISTINCT ON (ulp.track_id) ulp.track_id, uj.date, uj.name AS journey_name
      FROM user_logged_parts ulp
      JOIN user_journeys uj ON uj.id = ulp.journey_id
      WHERE ulp.user_id = $1
      ORDER BY ulp.track_id, uj.date DESC NULLS LAST, uj.created_at DESC
    ) latest
    JOIN railway_routes rr ON rr.track_id = latest.track_id
      ${region ? `AND ${regionContainsSql(region, "rr.starting_coordinate")}` : ""}
    LEFT JOIN (${FULLY_RIDDEN_TRACK_IDS}) ridden ON ridden.track_id = latest.track_id
    ORDER BY latest.track_id
    `,
    [userId],
  );
  return result.rows;
}

/**
 * The stretches a user has ridden on routes they haven't completed.
 *
 * Routes ridden whole are left out — including those completed by their
 * stretches adding up (FULLY_RIDDEN_TRACK_IDS): their line is already drawn in
 * the visited colour, so an overlay would add nothing. Stretches from different
 * journeys are returned separately and simply painted over each other — the
 * union comes out right without computing it.
 *
 * `region` keeps the other region's stretches out: the map shows one region,
 * and each stretch is cut from its route's full geometry. `null` returns every
 * region's, for the mobile API, whose overlay relies on its country filter.
 */
export async function coveredStretchesForUser(
  userId: number,
  region: RegionId | null,
): Promise<CoveredStretch[]> {
  const result = await pool.query<CoveredRange>(
    `
    SELECT DISTINCT ulp.track_id, ulp.covered_start, ulp.covered_end
    FROM user_logged_parts ulp
    ${region ? `JOIN railway_routes rr ON rr.track_id = ulp.track_id AND ${regionContainsSql(region, "rr.starting_coordinate")}` : ""}
    WHERE ulp.user_id = $1
      AND ulp.partial = TRUE
      AND ulp.covered_start IS NOT NULL
      -- NOT EXISTS rather than NOT IN: a NULL in the set would make NOT IN
      -- answer NULL for every row
      AND NOT EXISTS (
        SELECT 1 FROM (${FULLY_RIDDEN_TRACK_IDS}) ridden WHERE ridden.track_id = ulp.track_id
      )
    `,
    [userId],
  );

  return buildCoveredStretches(result.rows);
}
