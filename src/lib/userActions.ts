'use server';

import { query } from './db';
import { getUser } from './authActions';
import { Station, GeoJSONFeatureCollection, GeoJSONFeature, RailwayRoute, UserTrip } from './types';
import { SUPPORTED_COUNTRIES } from './constants';

export async function searchStations(searchQuery: string): Promise<Station[]> {
  if (searchQuery.trim().length < 2) {
    return [];
  }

  const result = await query(`
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
  `, [`%${searchQuery}%`, `${searchQuery}%`]);

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    coordinates: [row.lon, row.lat]
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
      track_number,
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

  return result.rows.map(row => ({
    ...row,
    track_id: row.track_id.toString(),
  }));
}

export async function updateMultipleRoutes(
  trackIds: number[],
  date: string,
  note: string | null = null,
  partialValues: boolean[] = []
): Promise<void> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const userId = user.id;

  const values = trackIds.map((trackId, idx) => {
    const offset = idx * 5;
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
  }).join(', ');

  const params = trackIds.flatMap((trackId, idx) => {
    const isPartial = partialValues[idx] ?? false;

    return [
      userId,
      trackId,
      date,
      note || null,
      isPartial
    ];
  });

  await query(`
    INSERT INTO user_trips (user_id, track_id, date, note, partial)
    VALUES ${values}
  `, params);
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
    throw new Error('User not authenticated');
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
      completedRoutes: 0
    };
  }

  // Get total distance and count of all routes (excluding Special usage_type=1, optionally filtered by countries)
  const totalResult = await query(
    `SELECT
      COALESCE(SUM(length_km), 0) as total_km,
      COUNT(*) as total_routes
    FROM railway_routes
    WHERE length_km IS NOT NULL
      AND usage_type != 1
      ${hasCountries ? 'AND start_country = ANY($1::text[]) AND end_country = ANY($1::text[])' : ''}`,
    hasCountries ? [selectedCountries] : []
  );

  // Get completed distance and count (routes with at least one complete trip, excluding Special usage_type=1)
  // Use EXISTS to ensure each route is only counted once regardless of number of trips
  const completedResult = await query(
    `SELECT
      COALESCE(SUM(rr.length_km), 0) as completed_km,
      COUNT(*) as completed_routes
    FROM railway_routes rr
    WHERE rr.usage_type != 1
      AND rr.length_km IS NOT NULL
      ${hasCountries ? 'AND start_country = ANY($2::text[]) AND end_country = ANY($2::text[])' : ''}
      AND EXISTS (
        SELECT 1
        FROM user_trips ut
        WHERE ut.track_id = rr.track_id
          AND ut.user_id = $1
          AND ut.date IS NOT NULL
          AND (ut.partial IS NULL OR ut.partial = FALSE)
      )`,
    hasCountries ? [userId, selectedCountries] : [userId]
  );

  const totalKm = parseFloat(totalResult.rows[0].total_km) || 0;
  const completedKm = parseFloat(completedResult.rows[0].completed_km) || 0;
  const totalRoutes = parseInt(totalResult.rows[0].total_routes) || 0;
  const completedRoutes = parseInt(completedResult.rows[0].completed_routes) || 0;

  const percentage = totalKm > 0 ? (completedKm / totalKm) * 100 : 0;
  const routePercentage = totalRoutes > 0 ? (completedRoutes / totalRoutes) * 100 : 0;

  return {
    totalKm: Math.round(totalKm * 10) / 10,
    completedKm: Math.round(completedKm * 10) / 10,
    percentage: Math.round(percentage),
    routePercentage: Math.round(routePercentage),
    totalRoutes,
    completedRoutes
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
    throw new Error('User not authenticated');
  }

  const userId = user.id;

  // Get stats for each country (routes where BOTH start AND end are in that country)
  const countryStats: CountryProgress[] = [];

  for (const country of SUPPORTED_COUNTRIES) {
    // Get total km for routes starting AND ending in this country (excluding Special)
    const totalResult = await query(
      `SELECT COALESCE(SUM(length_km), 0) as total_km
       FROM railway_routes
       WHERE length_km IS NOT NULL
         AND usage_type != 1
         AND start_country = $1
         AND end_country = $1`,
      [country.code]
    );

    // Get completed km for routes in this country
    const completedResult = await query(
      `SELECT COALESCE(SUM(rr.length_km), 0) as completed_km
       FROM railway_routes rr
       WHERE rr.usage_type != 1
         AND rr.length_km IS NOT NULL
         AND rr.start_country = $1
         AND rr.end_country = $1
         AND EXISTS (
           SELECT 1
           FROM user_trips ut
           WHERE ut.track_id = rr.track_id
             AND ut.user_id = $2
             AND ut.date IS NOT NULL
             AND (ut.partial IS NULL OR ut.partial = FALSE)
         )`,
      [country.code, userId]
    );

    const totalKm = parseFloat(totalResult.rows[0].total_km) || 0;
    const completedKm = parseFloat(completedResult.rows[0].completed_km) || 0;

    countryStats.push({
      countryCode: country.code,
      countryName: country.name,
      totalKm: Math.round(totalKm * 10) / 10,
      completedKm: Math.round(completedKm * 10) / 10,
    });
  }

  // Get overall total (all routes regardless of country)
  const overallTotalResult = await query(
    `SELECT COALESCE(SUM(length_km), 0) as total_km
     FROM railway_routes
     WHERE length_km IS NOT NULL
       AND usage_type != 1`
  );

  const overallCompletedResult = await query(
    `SELECT COALESCE(SUM(rr.length_km), 0) as completed_km
     FROM railway_routes rr
     WHERE rr.usage_type != 1
       AND rr.length_km IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM user_trips ut
         WHERE ut.track_id = rr.track_id
           AND ut.user_id = $1
           AND ut.date IS NOT NULL
           AND (ut.partial IS NULL OR ut.partial = FALSE)
       )`,
    [userId]
  );

  const overallTotalKm = parseFloat(overallTotalResult.rows[0].total_km) || 0;
  const overallCompletedKm = parseFloat(overallCompletedResult.rows[0].completed_km) || 0;

  return {
    byCountry: countryStats,
    total: {
      totalKm: Math.round(overallTotalKm * 10) / 10,
      completedKm: Math.round(overallCompletedKm * 10) / 10,
    }
  };
}

/**
 * Get all trips for a specific route for the current user
 */
export async function getUserTrips(trackId: string): Promise<UserTrip[]> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const result = await query(`
    SELECT id, track_id,
           TO_CHAR(date, 'YYYY-MM-DD') as date,
           note, partial, created_at, updated_at
    FROM user_trips
    WHERE user_id = $1 AND track_id = $2
    ORDER BY date ASC NULLS FIRST, created_at ASC
  `, [user.id, parseInt(trackId)]);

  return result.rows;
}

/**
 * Add a new trip for a route
 */
export async function addUserTrip(
  trackId: string,
  date: string,
  note?: string | null,
  partial?: boolean
): Promise<void> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  await query(`
    INSERT INTO user_trips (user_id, track_id, date, note, partial)
    VALUES ($1, $2, $3, $4, $5)
  `, [user.id, parseInt(trackId), date, note || null, partial ?? false]);
}

/**
 * Update an existing trip
 */
export async function updateUserTrip(
  tripId: number,
  date: string,
  note?: string | null,
  partial?: boolean
): Promise<void> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  // Verify the trip belongs to the current user
  await query(`
    UPDATE user_trips
    SET date = $2, note = $3, partial = $4, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND user_id = $5
  `, [tripId, date, note || null, partial ?? false, user.id]);
}

/**
 * Delete a trip
 */
export async function deleteUserTrip(tripId: number): Promise<void> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  // Verify the trip belongs to the current user before deleting
  await query(`
    DELETE FROM user_trips
    WHERE id = $1 AND user_id = $2
  `, [tripId, user.id]);
}
