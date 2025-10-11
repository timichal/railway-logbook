'use server';

import pool from './db';
import { RailwayPart } from './types';

export async function getRailwayPartsByIds(partIds: string[]): Promise<RailwayPart[]> {
  if (partIds.length === 0) return [];
  
  const client = await pool.connect();
  
  try {
    console.log('Fetching railway parts for IDs:', partIds);
    
    // Create placeholders for the IN query
    const placeholders = partIds.map((_, index) => `$${index + 1}`).join(',');
    
    const query = `
      SELECT 
        id,
        ST_AsGeoJSON(geometry) as geometry_json
      FROM railway_parts 
      WHERE id IN (${placeholders})
        AND geometry IS NOT NULL
    `;
    
    const result = await client.query(query, partIds);

    const features: RailwayPart[] = result.rows
      .map(row => {
        const geom = JSON.parse(row.geometry_json);
        // Only return LineString features to match RailwayPart type
        if (geom.type === 'LineString') {
          return {
            type: 'Feature' as const,
            geometry: geom,
            properties: {
              '@id': parseInt(row.id)
            }
          } as RailwayPart;
        }
        return null;
      })
      .filter((feature): feature is RailwayPart => feature !== null);
    
    console.log('Fetched', features.length, 'railway parts from database');
    return features;
    
  } catch (error) {
    console.error('Error fetching railway parts by IDs:', error);
    throw error;
  } finally {
    client.release();
  }
}