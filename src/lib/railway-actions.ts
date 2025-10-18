'use server';

import { query } from './db';
import { getUser } from './auth-actions';
import { Station, GeoJSONFeatureCollection, GeoJSONFeature, RailwayRoute } from './types';

export async function getAllStations(): Promise<Station[]> {
  const result = await query(`
    SELECT id, name,
           ST_X(coordinates) as lon,
           ST_Y(coordinates) as lat
    FROM stations
    ORDER BY name
  `);

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    coordinates: [row.lon, row.lat]
  }));
}

export async function searchStations(searchQuery: string): Promise<Station[]> {
  if (searchQuery.trim().length < 2) {
    return [];
  }

  const result = await query(`
    SELECT id, name,
           ST_X(coordinates) as lon,
           ST_Y(coordinates) as lat
    FROM stations
    WHERE name ILIKE $1
    ORDER BY name
    LIMIT 10
  `, [`%${searchQuery}%`]);

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

  // Get railway routes with user data
  const routesResult = await query(`
    SELECT
      rr.track_id,
      rr.name,
      rr.description,
      rr.usage_type,
      ST_AsGeoJSON(rr.geometry) as geometry,
      urd.date,
      urd.note,
      urd.partial
    FROM railway_routes rr
    LEFT JOIN user_railway_data urd ON rr.track_id = urd.track_id AND urd.user_id = $1
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
        name: route.name,
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
  await query(`
    INSERT INTO user_railway_data (user_id, track_id, date, note, partial)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id, track_id)
    DO UPDATE SET
      date = EXCLUDED.date,
      note = EXCLUDED.note,
      partial = EXCLUDED.partial,
      updated_at = CURRENT_TIMESTAMP
  `, [userId, trackId, date || null, note || null, partial ?? false]);
}

export async function quickLogRoute(trackId: string): Promise<void> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const userId = user.id;
  const today = new Date().toISOString().split('T')[0];

  await query(`
    INSERT INTO user_railway_data (user_id, track_id, date, note, partial)
    VALUES ($1, $2, $3, NULL, FALSE)
    ON CONFLICT (user_id, track_id)
    DO UPDATE SET
      date = EXCLUDED.date,
      partial = FALSE,
      updated_at = CURRENT_TIMESTAMP
  `, [userId, trackId, today]);
}

export async function quickUnlogRoute(trackId: string): Promise<void> {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const userId = user.id;

  await query(`
    INSERT INTO user_railway_data (user_id, track_id, date, note, partial)
    VALUES ($1, $2, NULL, NULL, FALSE)
    ON CONFLICT (user_id, track_id)
    DO UPDATE SET
      date = NULL,
      partial = FALSE,
      updated_at = CURRENT_TIMESTAMP
  `, [userId, trackId]);
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

  // Get total distance and count of all routes (excluding Special usage_type=2)
  const totalResult = await query(`
    SELECT
      COALESCE(SUM(length_km), 0) as total_km,
      COUNT(*) as total_routes
    FROM railway_routes
    WHERE length_km IS NOT NULL
      AND usage_type != 2
  `);

  // Get completed distance and count (routes with date AND not partial, excluding Special usage_type=2)
  const completedResult = await query(`
    SELECT
      COALESCE(SUM(rr.length_km), 0) as completed_km,
      COUNT(*) as completed_routes
    FROM railway_routes rr
    INNER JOIN user_railway_data urd ON rr.track_id = urd.track_id
    WHERE urd.user_id = $1
      AND urd.date IS NOT NULL
      AND (urd.partial IS NULL OR urd.partial = FALSE)
      AND rr.length_km IS NOT NULL
      AND rr.usage_type != 2
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
    SELECT track_id, name, track_number, description, usage_type,
           starting_part_id, ending_part_id, is_valid, error_message
    FROM railway_routes
    ORDER BY name
  `);

  return result.rows;
}

export async function getRailwayRoute(trackId: string) {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await query(`
    SELECT track_id, name, track_number, description, usage_type,
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
  name: string,
  trackNumber: string | null,
  description: string | null,
  usageType: string
) {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  await query(`
    UPDATE railway_routes
    SET name = $2, track_number = $3, description = $4, usage_type = $5, updated_at = CURRENT_TIMESTAMP
    WHERE track_id = $1
  `, [trackId, name, trackNumber, description, parseInt(usageType)]);
}

export async function getAllRailwayRoutesWithGeometry(): Promise<GeoJSONFeatureCollection> {
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  const result = await query(`
    SELECT track_id, name, track_number, description, usage_type,
           ST_AsGeoJSON(geometry) as geometry,
           starting_part_id, ending_part_id, is_valid, error_message
    FROM railway_routes
    ORDER BY name
  `);

  const features: GeoJSONFeature[] = result.rows.map(row => ({
    type: 'Feature' as const,
    geometry: JSON.parse(row.geometry),
    properties: {
      track_id: row.track_id,
      name: row.name,
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
