'use server';

import pool from './db';
import { getUser } from './auth-actions';

export interface PathResult {
  partIds: string[];
  coordinates: [number, number][];
}

interface RailwayPart {
  id: string;
  coordinates: [number, number][];
  startPoint: [number, number];
  endPoint: [number, number];
}

class DatabasePathFinder {
  private parts: Map<string, RailwayPart> = new Map();
  private coordToPartIds: Map<string, string[]> = new Map();

  async loadRailwayParts(startId: string, endId: string): Promise<void> {
    console.log('DatabasePathFinder: Loading railway parts within search area');

    const client = await pool.connect();
    try {
      // Create a buffer around start and end points to limit search space
      // Using 50km buffer in Web Mercator (meters)
      const bufferMeters = 50000;

      const result = await client.query(`
        WITH endpoints AS (
          SELECT geometry
          FROM railway_parts
          WHERE id = $1 OR id = $2
        ),
        search_area AS (
          SELECT ST_Transform(
            ST_Buffer(
              ST_Transform(ST_Collect(geometry), 3857),
              $3
            ),
            4326
          ) as buffer_geom
          FROM endpoints
        )
        SELECT
          rp.id,
          ST_AsGeoJSON(rp.geometry) as geometry_json
        FROM railway_parts rp, search_area
        WHERE ST_Intersects(rp.geometry, search_area.buffer_geom)
          AND rp.geometry IS NOT NULL
      `, [startId, endId, bufferMeters]);

      console.log(`DatabasePathFinder: Loaded ${result.rows.length} railway parts within 50km (spatial index optimization)`);

      for (const row of result.rows) {
        const id = String(row.id); // Use String() to safely convert any type
        const geom = JSON.parse(row.geometry_json);
        
        if (geom.type === 'LineString' && geom.coordinates.length >= 2) {
          const coordinates = geom.coordinates as [number, number][];
          const startPoint = coordinates[0];
          const endPoint = coordinates[coordinates.length - 1];
          
          const part: RailwayPart = {
            id,
            coordinates,
            startPoint,
            endPoint
          };
          
          this.parts.set(id, part);
          
          // Add to coordinate mapping for fast connection lookups
          const startKey = this.coordinateToKey(startPoint);
          const endKey = this.coordinateToKey(endPoint);
          
          if (!this.coordToPartIds.has(startKey)) {
            this.coordToPartIds.set(startKey, []);
          }
          if (!this.coordToPartIds.has(endKey)) {
            this.coordToPartIds.set(endKey, []);
          }
          
          this.coordToPartIds.get(startKey)!.push(id);
          if (startKey !== endKey) { // Avoid duplicates for closed loops
            this.coordToPartIds.get(endKey)!.push(id);
          }
        }
      }
      
      console.log(`DatabasePathFinder: Built coordinate mapping for ${this.coordToPartIds.size} unique coordinates`);
    } finally {
      client.release();
    }
  }

  private coordinateToKey(coord: [number, number]): string {
    // Round to 7 decimal places to handle floating point precision
    return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
  }

  private getConnectedPartIds(partId: string): string[] {
    const part = this.parts.get(partId);
    if (!part) return [];

    const connected = new Set<string>();
    
    // Check connections at start coordinate
    const startKey = this.coordinateToKey(part.startPoint);
    const startConnected = this.coordToPartIds.get(startKey) || [];
    startConnected.forEach(id => {
      if (id !== partId) connected.add(id);
    });

    // Check connections at end coordinate  
    const endKey = this.coordinateToKey(part.endPoint);
    const endConnected = this.coordToPartIds.get(endKey) || [];
    endConnected.forEach(id => {
      if (id !== partId) connected.add(id);
    });

    return Array.from(connected);
  }

  public findPath(startId: string, endId: string): PathResult | null {
    if (!this.parts.has(startId)) {
      console.error(`Start railway part ID ${startId} not found in loaded parts`);
      return null;
    }
    if (!this.parts.has(endId)) {
      console.error(`End railway part ID ${endId} not found in loaded parts`);
      return null;
    }

    if (startId === endId) {
      const part = this.parts.get(startId)!;
      return {
        partIds: [startId],
        coordinates: part.coordinates
      };
    }

    console.log(`DatabasePathFinder: Finding path from ${startId} to ${endId}...`);

    // BFS to find shortest path
    const queue: { id: string; path: string[] }[] = [{ id: startId, path: [startId] }];
    const visited = new Set<string>([startId]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Get all connected parts
      const connected = this.getConnectedPartIds(current.id);

      for (const connectedId of connected) {
        if (connectedId === endId) {
          // Found the target!
          const pathIds = [...current.path, connectedId];
          return this.buildPathResult(pathIds);
        }

        if (!visited.has(connectedId)) {
          visited.add(connectedId);
          queue.push({
            id: connectedId,
            path: [...current.path, connectedId]
          });
        }
      }
    }

    return null; // No path found
  }

  private buildPathResult(partIds: string[]): PathResult {
    const coordinates: [number, number][] = [];

    for (let i = 0; i < partIds.length; i++) {
      const part = this.parts.get(partIds[i]);
      if (!part) continue;

      if (i === 0) {
        // First segment - add all coordinates
        coordinates.push(...part.coordinates);
      } else {
        // Subsequent segments - check connection and add coordinates
        const prevPart = this.parts.get(partIds[i - 1]);
        if (!prevPart) continue;

        const prevEndKey = this.coordinateToKey(prevPart.endPoint);
        const currStartKey = this.coordinateToKey(part.startPoint);
        const currEndKey = this.coordinateToKey(part.endPoint);

        if (prevEndKey === currStartKey) {
          // Connected at current start, add from index 1 (skip duplicate)
          coordinates.push(...part.coordinates.slice(1));
        } else if (prevEndKey === currEndKey) {
          // Connected at current end, reverse and add from index 1
          const reversedCoords = [...part.coordinates].reverse();
          coordinates.push(...reversedCoords.slice(1));
        } else {
          console.warn(`DatabasePathFinder: No connection found between ${partIds[i-1]} and ${partIds[i]}`);
          // Add all coordinates anyway
          coordinates.push(...part.coordinates);
        }
      }
    }

    return {
      partIds,
      coordinates
    };
  }
}

export async function findRailwayPathDB(startId: string, endId: string): Promise<PathResult | null> {
  // Admin check
  const user = await getUser();
  if (!user || user.id !== 1) {
    throw new Error('Admin access required');
  }

  console.log('Database path finder: Finding path from', startId, 'to', endId);

  const pathFinder = new DatabasePathFinder();
  await pathFinder.loadRailwayParts(startId, endId);

  const result = pathFinder.findPath(startId, endId);

  if (result) {
    console.log('Database path finder: Path found with', result.partIds.length, 'segments and', result.coordinates.length, 'coordinates');
  } else {
    console.log('Database path finder: No path found');
  }

  return result;
}