'use server';

import { query } from './db';
import { Station, RailwayRoute, UserRailwayData, RailwayRouteWithUserData, GeoJSONFeatureCollection } from './types';

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

export async function getAllRailwayRoutes(userId: number = 1): Promise<RailwayRouteWithUserData[]> {
  const result = await query(`
    SELECT 
      rr.track_id,
      rr.name,
      rr.usage_types,
      rr.primary_operator,
      ST_AsGeoJSON(rr.geometry) as geometry,
      rr.color,
      rr.weight,
      urd.last_ride,
      urd.note
    FROM railway_routes rr
    LEFT JOIN user_railway_data urd ON rr.track_id = urd.track_id AND urd.user_id = $1
    ORDER BY rr.name
  `, [userId]);

  return result.rows.map(row => {
    const route: RailwayRouteWithUserData = {
      track_id: row.track_id,
      name: row.name,
      usage_types: row.usage_types || [],
      primary_operator: row.primary_operator,
      geometry: JSON.parse(row.geometry),
      color: row.color,
      weight: row.weight
    };

    if (row.last_ride || row.note) {
      route.user_data = {
        user_id: userId,
        track_id: row.track_id,
        last_ride: row.last_ride,
        note: row.note
      };
    }

    return route;
  });
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
      rr.usage_types,
      rr.primary_operator,
      ST_AsGeoJSON(rr.geometry) as geometry,
      rr.color,
      rr.weight,
      urd.last_ride,
      urd.note
    FROM railway_routes rr
    LEFT JOIN user_railway_data urd ON rr.track_id = urd.track_id AND urd.user_id = $1
  `, [userId]);

  const features = [];

  // Helper function to generate description from usage types and operator
  const generateDescription = (usageTypes: string[], operator: string, lastRide?: string, note?: string) => {
    const usageMap: Record<string, string> = {
      'Regular': 'Pravidelný provoz',
      'OnceDaily': 'Provoz jednou denně',
      'Seasonal': 'Sezónní provoz',
      'OnceWeekly': 'Provoz jednou týdně',
      'Weekdays': 'Provoz o pracovních dnech',
      'Weekends': 'Provoz o víkendech',
      'Special': 'Provoz při zvláštních příležitostech'
    };

    const usage = usageTypes.map(type => usageMap[type] || type).join(', ') || 'Pravidelný provoz';
    let description = `${usage}, ${operator}`;
    
    if (lastRide) {
      description += `\n\nNaposledy projeto: ${lastRide}`;
    }
    if (note) {
      description += `\n\n*${note}*`;
    }
    
    return description;
  };

  // Add station features
  for (const station of stationsResult.rows) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [station.lon, station.lat]
      },
      properties: {
        '@id': station.id,
        name: station.name,
        railway: 'station'
      }
    });
  }

  // Add railway route features
  for (const route of routesResult.rows) {
    const description = generateDescription(
      route.usage_types || [],
      route.primary_operator || 'Unknown',
      route.last_ride,
      route.note
    );

    features.push({
      type: 'Feature',
      geometry: JSON.parse(route.geometry),
      properties: {
        name: route.name,
        description: description,
        track_id: route.track_id,
        railway: 'rail',
        _umap_options: {
          color: route.color,
          weight: route.weight
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
