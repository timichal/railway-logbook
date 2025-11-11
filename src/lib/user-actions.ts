'use server';

import { query } from './db';
import { getUser } from './auth-actions';
import { Station, GeoJSONFeatureCollection, GeoJSONFeature, RailwayRoute } from './types';

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

export async function getRailwayDataAsGeoJSON(): Promise<GeoJSONFeatureCollection> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const userId = user.id;
  // Get stations
  const stationsResult = await query(`
    SELECT id, name,
           ST_X(coordinates) as lon,
           ST_Y(coordinates) as lat
    FROM stations
  `);

  // Get railway routes with user data (most recent trip per route)
  const routesResult = await query(`
    SELECT
      rr.track_id,
      rr.from_station,
      rr.to_station,
      rr.description,
      rr.usage_type,
      rr.frequency,
      ST_AsGeoJSON(rr.geometry) as geometry,
      ut.date,
      ut.note,
      ut.partial
    FROM railway_routes rr
    LEFT JOIN LATERAL (
      SELECT date, note, partial
      FROM user_trips
      WHERE track_id = rr.track_id AND user_id = $1
      ORDER BY date DESC NULLS LAST, created_at DESC
      LIMIT 1
    ) ut ON true
  `, [userId]);

  const features: GeoJSONFeature[] = [];

  // Add station features
  for (const station of stationsResult.rows) {
    features.push({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [station.lon, station.lat]
      },
      properties: {
        '@id': station.id,
        name: station.name,
      }
    });
  }

  // Add railway route features
  for (const route of (routesResult.rows as RailwayRoute[])) {
    features.push({
      type: 'Feature' as const,
      geometry: JSON.parse(route.geometry),
      properties: {
        name: `${route.from_station} ⟷ ${route.to_station}`,
        description: route.description ?? undefined,
        track_id: route.track_id,
        usage: route.usage_type,
        custom: {
          date: route.date ?? undefined,
          note: route.note ?? undefined,
          partial: route.partial ?? undefined,
        }
      }
    });
  }

  return {
    type: 'FeatureCollection',
    features
  };
}

export async function updateUserRailwayData(
  trackId: string,
  date?: string | null,
  note?: string | null,
  partial?: boolean | null
): Promise<void> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const userId = user.id;

  // For single route updates, we update the most recent trip or create a new one
  // If date is null, we're "unlogging" - delete all trips for this route
  if (date === null) {
    await query(`
      DELETE FROM user_trips
      WHERE user_id = $1 AND track_id = $2
    `, [userId, trackId]);
  } else {
    // Check if there's an existing trip for today
    const existingTrip = await query(`
      SELECT id FROM user_trips
      WHERE user_id = $1 AND track_id = $2 AND date = $3
      LIMIT 1
    `, [userId, trackId, date]);

    if (existingTrip.rows.length > 0) {
      // Update existing trip for this date
      await query(`
        UPDATE user_trips
        SET note = $1, partial = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [note || null, partial ?? false, existingTrip.rows[0].id]);
    } else {
      // Create new trip
      await query(`
        INSERT INTO user_trips (user_id, track_id, date, note, partial)
        VALUES ($1, $2, $3, $4, $5)
      `, [userId, trackId, date, note || null, partial ?? false]);
    }
  }
}

export async function quickLogRoute(trackId: string): Promise<void> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const userId = user.id;
  const today = new Date().toISOString().split('T')[0];

  // Always create new trip (allow multiple trips on same day)
  await query(`
    INSERT INTO user_trips (user_id, track_id, date, note, partial)
    VALUES ($1, $2, $3, NULL, FALSE)
  `, [userId, parseInt(trackId), today]);
}

export async function quickUnlogRoute(trackId: string): Promise<void> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const userId = user.id;

  // Delete all trips for this route
  await query(`
    DELETE FROM user_trips
    WHERE user_id = $1 AND track_id = $2
  `, [userId, trackId]);
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

export async function getUserProgress(): Promise<UserProgress> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const userId = user.id;

  // Get total distance and count of all routes (excluding Special usage_type=1)
  const totalResult = await query(`
    SELECT
      COALESCE(SUM(length_km), 0) as total_km,
      COUNT(*) as total_routes
    FROM railway_routes
    WHERE length_km IS NOT NULL
      AND usage_type != 1
  `);

  // Get completed distance and count (routes with at least one complete trip, excluding Special usage_type=1)
  // Use EXISTS to ensure each route is only counted once regardless of number of trips
  const completedResult = await query(`
    SELECT
      COALESCE(SUM(rr.length_km), 0) as completed_km,
      COUNT(*) as completed_routes
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
      )
  `, [userId]);

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

export interface UserTrip {
  id: number;
  track_id: number;
  date: string;
  note: string | null;
  partial: boolean;
  created_at: string;
  updated_at: string;
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
