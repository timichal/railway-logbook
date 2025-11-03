'use server';

import { query } from './db';
import { getUser } from './auth-actions';
import { Station, GeoJSONFeatureCollection, GeoJSONFeature, RailwayRoute } from './types';
import type { UsageType } from './constants';

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

  // Check if there's already a trip for today
  const existingTrip = await query(`
    SELECT id FROM user_trips
    WHERE user_id = $1 AND track_id = $2 AND date = $3
    LIMIT 1
  `, [userId, trackId, today]);

  if (existingTrip.rows.length === 0) {
    // Create new trip for today
    await query(`
      INSERT INTO user_trips (user_id, track_id, date, note, partial)
      VALUES ($1, $2, $3, NULL, FALSE)
    `, [userId, trackId, today]);
  }
  // If trip already exists for today, do nothing
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
  date?: string | null,
  note?: string | null,
  partial?: boolean | null
): Promise<void> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const userId = user.id;

  // For bulk logging (e.g., multi-route logger), create a new trip for each route
  // This allows users to log the same journey multiple times
  if (!date) {
    throw new Error('Date is required for bulk logging');
  }

  const values = trackIds.map((trackId, idx) => {
    const offset = idx * 5;
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`;
  }).join(', ');

  const params = trackIds.flatMap(trackId => [
    userId,
    trackId,
    date,
    note || null,
    partial ?? false
  ]);

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

  // Get completed distance and count (routes with date AND not partial, excluding Special usage_type=1)
  const completedResult = await query(`
    SELECT
      COALESCE(SUM(rr.length_km), 0) as completed_km,
      COUNT(DISTINCT rr.track_id) as completed_routes
    FROM railway_routes rr
    INNER JOIN user_trips ut ON rr.track_id = ut.track_id
    WHERE ut.user_id = $1
      AND ut.date IS NOT NULL
      AND (ut.partial IS NULL OR ut.partial = FALSE)
      AND rr.length_km IS NOT NULL
      AND rr.usage_type != 1
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



// Admin functions for managing railway routes
export async function getAllRailwayRoutes() {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await query(`
    SELECT track_id, from_station, to_station, track_number, description, usage_type,
           starting_part_id, ending_part_id, is_valid, error_message
    FROM railway_routes
    ORDER BY from_station, to_station
  `);

  return result.rows;
}

export async function getRailwayRoute(trackId: string) {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await query(`
    SELECT track_id, from_station, to_station, track_number, description, usage_type, frequency, link,
           ST_AsGeoJSON(geometry) as geometry, length_km,
           starting_part_id, ending_part_id, is_valid, error_message
    FROM railway_routes
    WHERE track_id = $1
  `, [trackId]);

  if (result.rows.length === 0) {
    throw new Error('Route not found');
  }

  return result.rows[0];
}

export async function updateRailwayRoute(
  trackId: string,
  fromStation: string,
  toStation: string,
  trackNumber: string | null,
  description: string | null,
  usageType: UsageType,
  frequency: string[],
  link: string | null
) {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  await query(`
    UPDATE railway_routes
    SET from_station = $2, to_station = $3, track_number = $4, description = $5, usage_type = $6, frequency = $7, link = $8,
        is_valid = TRUE, error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE track_id = $1
  `, [trackId, fromStation, toStation, trackNumber, description, usageType, frequency || [], link]);
}

export async function getAllRailwayRoutesWithGeometry(): Promise<GeoJSONFeatureCollection> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await query(`
    SELECT track_id, from_station, to_station, track_number, description, usage_type,
           ST_AsGeoJSON(geometry) as geometry,
           starting_part_id, ending_part_id, is_valid, error_message
    FROM railway_routes
    ORDER BY from_station, to_station
  `);

  const features: GeoJSONFeature[] = result.rows.map(row => ({
    type: 'Feature' as const,
    geometry: JSON.parse(row.geometry),
    properties: {
      track_id: row.track_id,
      name: `${row.from_station} ⟷ ${row.to_station}`,
      description: row.description ?? undefined,
      usage: row.usage_type,
      starting_part_id: row.starting_part_id,
      ending_part_id: row.ending_part_id,
      is_valid: row.is_valid,
      error_message: row.error_message ?? undefined
    }
  }));

  return {
    type: 'FeatureCollection',
    features
  };
}

export async function getRailwayPartsByBounds(
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  },
  zoom: number
): Promise<GeoJSONFeatureCollection> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  // Get railway parts within bounds (original geometry only)
  // Use different strategies based on zoom level to avoid gaps
  let partsResult;

  if (zoom < 8) {
    // For very low zoom, show only major railway segments (longer ones)
    // Use a higher limit to avoid gaps in main lines
    partsResult = await query(`
      SELECT 
        id,
        ST_AsGeoJSON(geometry) as geometry
      FROM railway_parts
      WHERE ST_Intersects(
        geometry, 
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
      AND ST_Length(geometry) > 0.001  -- Filter out very short segments
      ORDER BY ST_Length(geometry) DESC
      LIMIT 10000
    `, [bounds.west, bounds.south, bounds.east, bounds.north]);
  } else {
    // For higher zoom levels, show more detail with reasonable limits
    const limit = zoom < 10 ? 20000 : zoom < 12 ? 40000 : 50000;
    partsResult = await query(`
      SELECT 
        id,
        ST_AsGeoJSON(geometry) as geometry
      FROM railway_parts
      WHERE ST_Intersects(
        geometry, 
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
      ORDER BY ST_Length(geometry) DESC
      LIMIT $5
    `, [bounds.west, bounds.south, bounds.east, bounds.north, limit]);
  }

  const features: GeoJSONFeature[] = [];

  // Add railway parts features
  for (const part of partsResult.rows) {
    features.push({
      type: 'Feature' as const,
      geometry: JSON.parse(part.geometry),
      properties: {
        '@id': part.id,
        zoom_level: zoom
      }
    });
  }

  return {
    type: 'FeatureCollection',
    features
  };
}
