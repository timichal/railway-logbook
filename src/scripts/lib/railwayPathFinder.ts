import { Client, Pool, PoolClient } from 'pg';
import type { PathResult } from '../../lib/types';

export type { PathResult };

interface RailwayPart {
  id: string;
  coordinates: [number, number][];
  startPoint: [number, number];
  endPoint: [number, number];
}

export class RailwayPathFinder {
  private parts: Map<string, RailwayPart> = new Map();
  private coordToPartIds: Map<string, string[]> = new Map();

  async loadRailwayParts(
    dbClient: Client | Pool,
    startId: string,
    endId: string,
    bufferMeters: number = 50000
  ): Promise<void> {
    // Handle both Pool and Client - get a client if needed
    let client: Client | PoolClient;
    let shouldRelease = false;

    // Check if it's a Pool by checking for the 'totalCount' property
    // which is unique to Pool and not present on Client
    if ('totalCount' in dbClient) {
      // It's a Pool
      client = await (dbClient as Pool).connect();
      shouldRelease = true;
    } else {
      // It's already a Client or PoolClient
      client = dbClient as Client;
    }

    try {
      // Create a buffer around start and end points to limit search space
      // Default: 50km buffer in Web Mercator (meters)

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
        ORDER BY rp.id
      `, [startId, endId, bufferMeters]);

      for (const row of result.rows) {
        const id = String(row.id);
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
    } finally {
      if (shouldRelease && 'release' in client) {
        client.release();
      }
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

    // Sort for deterministic BFS ordering
    return Array.from(connected).sort((a, b) => {
      const numA = parseInt(a);
      const numB = parseInt(b);
      return numA - numB;
    });
  }

  /**
   * Find path with automatic retry using larger buffer if initial search fails
   */
  async findPathWithRetry(
    dbClient: Client | Pool,
    startId: string,
    endId: string
  ): Promise<PathResult | null> {
    // First attempt with 50km buffer
    await this.loadRailwayParts(dbClient, startId, endId, 50000);
    let result = this.findPath(startId, endId);

    if (result) {
      console.log('Path found with 50km buffer');
      return result;
    }

    // Second attempt with 100km buffer
    console.log('Path not found with 50km buffer, retrying with 100km buffer...');
    this.clear(); // Clear previous data
    await this.loadRailwayParts(dbClient, startId, endId, 100000);
    result = this.findPath(startId, endId);

    if (result) {
      console.log('Path found with 100km buffer');
      return result;
    }

    // Third attempt with 150km buffer
    console.log('Path not found with 100km buffer, retrying with 150km buffer...');
    this.clear(); // Clear previous data
    await this.loadRailwayParts(dbClient, startId, endId, 150000);
    result = this.findPath(startId, endId);

    if (result) {
      console.log('Path found with 150km buffer');
    } else {
      console.log('Path not found even with 150km buffer');
    }

    return result;
  }

  /**
   * Clear all loaded railway parts data
   */
  clear(): void {
    this.parts.clear();
    this.coordToPartIds.clear();
  }

  public findPath(startId: string, endId: string): PathResult | null {
    if (!this.parts.has(startId)) {
      return null;
    }
    if (!this.parts.has(endId)) {
      return null;
    }

    if (startId === endId) {
      const part = this.parts.get(startId)!;
      return {
        partIds: [startId],
        coordinates: part.coordinates
      };
    }

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
    // Build a simple coordinate list by concatenating all part coordinates
    // Note: This is a fallback. In practice, the caller should use mergeLinearChain
    // from coordinate-utils.ts for proper coordinate ordering by fetching the actual
    // railway part geometries from the database.
    const coordinates: [number, number][] = [];

    for (const partId of partIds) {
      const part = this.parts.get(partId);
      if (part) {
        coordinates.push(...part.coordinates);
      }
    }

    return {
      partIds,
      coordinates
    };
  }
}
