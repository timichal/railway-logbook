'use server';

import { query } from './db';
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

export async function getRailwayDataAsGeoJSON(userId: number = 1): Promise<GeoJSONFeatureCollection> {
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
      rr.usage_types,
      rr.primary_operator,
      ST_AsGeoJSON(rr.geometry) as geometry,
      urd.last_ride,
      urd.note
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
        description: route.description,
        track_id: route.track_id,
        primary_operator: route.primary_operator,
        usage: route.usage_types.map(Number),
        custom: {
          last_ride: route.last_ride,
          note: route.note,
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
  userId: number,
  trackId: string,
  lastRide?: string,
  note?: string
): Promise<void> {
  await query(`
    INSERT INTO user_railway_data (user_id, track_id, last_ride, note)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, track_id) 
    DO UPDATE SET
      last_ride = COALESCE(EXCLUDED.last_ride, user_railway_data.last_ride),
      note = COALESCE(EXCLUDED.note, user_railway_data.note),
      updated_at = CURRENT_TIMESTAMP
  `, [userId, trackId, lastRide, note]);
}
