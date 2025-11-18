import { Client, Pool, PoolClient } from 'pg';
import type { PathResult, RailwayPartSplit } from '../../lib/types';

export type { PathResult };

interface RailwayPart {
  id: string;
  coordinates: [number, number][];
  startPoint: [number, number];
  endPoint: [number, number];
  originalPartId?: string; // Set for split segments (seg0, seg1)
  segmentIndex?: number; // 0 or 1 for split segments
}

export class RailwayPathFinder {
  private parts: Map<string, RailwayPart> = new Map();
  private coordToPartIds: Map<string, string[]> = new Map();
  private splits: Map<string, RailwayPartSplit> = new Map(); // partId -> split info

  /**
   * Extract original part ID from a segment ID
   * e.g., "12345_seg0" -> "12345", "12345" -> "12345"
   */
  private extractOriginalPartId(partId: string): string {
    const match = partId.match(/^(\d+)_seg[01]$/);
    return match ? match[1] : partId;
  }

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
      // First, load all splits in the search area
      const splitsResult = await client.query(`
        SELECT
          s.id,
          s.part_id,
          ST_AsGeoJSON(s.split_coordinate) as split_coordinate_json,
          s.split_fraction,
          s.created_at,
          s.created_by
        FROM railway_part_splits s
      `);

      for (const row of splitsResult.rows) {
        const splitCoordJson = JSON.parse(row.split_coordinate_json);
        this.splits.set(row.part_id.toString(), {
          id: row.id,
          part_id: row.part_id,
          split_coordinate: splitCoordJson.coordinates,
          split_fraction: parseFloat(row.split_fraction),
          created_at: row.created_at,
          created_by: row.created_by
        });
      }

      // Create a buffer around start and end points to limit search space
      // Default: 50km buffer in Web Mercator (meters)

      // Extract original part IDs from segment IDs (if any)
      const startPartId = this.extractOriginalPartId(startId);
      const endPartId = this.extractOriginalPartId(endId);

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
      `, [startPartId, endPartId, bufferMeters]);

      for (const row of result.rows) {
        const id = String(row.id);
        const geom = JSON.parse(row.geometry_json);

        if (geom.type === 'LineString' && geom.coordinates.length >= 2) {
          const coordinates = geom.coordinates as [number, number][];

          // Check if this part has a split
          const split = this.splits.get(id);

          if (split) {
            // Part is split - create two virtual segments
            this.createSplitSegments(id, coordinates, split);
          } else {
            // Normal part - add as is
            const startPoint = coordinates[0];
            const endPoint = coordinates[coordinates.length - 1];

            const part: RailwayPart = {
              id,
              coordinates,
              startPoint,
              endPoint
            };

            this.parts.set(id, part);
            this.addToCoordinateMapping(id, startPoint, endPoint);
          }
        }
      }
    } finally {
      if (shouldRelease && 'release' in client) {
        client.release();
      }
    }
  }

  /**
   * Create two virtual segments for a split part
   */
  private createSplitSegments(
    partId: string,
    coordinates: [number, number][],
    split: RailwayPartSplit
  ): void {
    // Calculate split index in coordinates array
    const splitFraction = split.split_fraction;
    const totalPoints = coordinates.length - 1;
    const splitIndex = Math.floor(splitFraction * totalPoints);

    // Ensure split index is valid
    if (splitIndex <= 0 || splitIndex >= coordinates.length - 1) {
      console.warn(`Invalid split fraction ${splitFraction} for part ${partId}, treating as unsplit`);
      const startPoint = coordinates[0];
      const endPoint = coordinates[coordinates.length - 1];
      const part: RailwayPart = {
        id: partId,
        coordinates,
        startPoint,
        endPoint
      };
      this.parts.set(partId, part);
      this.addToCoordinateMapping(partId, startPoint, endPoint);
      return;
    }

    // Split coordinate is the point where the segments meet
    const splitCoordinate = split.split_coordinate;

    // Segment 0: from start to split point (inclusive)
    const seg0Coords = coordinates.slice(0, splitIndex + 1);
    seg0Coords.push(splitCoordinate); // Add split point at the end

    const seg0: RailwayPart = {
      id: `${partId}_seg0`,
      coordinates: seg0Coords,
      startPoint: seg0Coords[0],
      endPoint: splitCoordinate,
      originalPartId: partId,
      segmentIndex: 0
    };

    // Segment 1: from split point to end
    const seg1Coords = [splitCoordinate, ...coordinates.slice(splitIndex + 1)];

    const seg1: RailwayPart = {
      id: `${partId}_seg1`,
      coordinates: seg1Coords,
      startPoint: splitCoordinate,
      endPoint: seg1Coords[seg1Coords.length - 1],
      originalPartId: partId,
      segmentIndex: 1
    };

    // Add both segments to parts map
    this.parts.set(seg0.id, seg0);
    this.parts.set(seg1.id, seg1);

    // Add to coordinate mapping
    this.addToCoordinateMapping(seg0.id, seg0.startPoint, seg0.endPoint);
    this.addToCoordinateMapping(seg1.id, seg1.startPoint, seg1.endPoint);
  }

  /**
   * Helper method to add a part to coordinate mapping
   */
  private addToCoordinateMapping(
    partId: string,
    startPoint: [number, number],
    endPoint: [number, number]
  ): void {
    const startKey = this.coordinateToKey(startPoint);
    const endKey = this.coordinateToKey(endPoint);

    if (!this.coordToPartIds.has(startKey)) {
      this.coordToPartIds.set(startKey, []);
    }
    if (!this.coordToPartIds.has(endKey)) {
      this.coordToPartIds.set(endKey, []);
    }

    this.coordToPartIds.get(startKey)!.push(partId);
    if (startKey !== endKey) { // Avoid duplicates for closed loops
      this.coordToPartIds.get(endKey)!.push(partId);
    }
  }

  private coordinateToKey(coord: [number, number]): string {
    // Round to 7 decimal places to handle floating point precision
    return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
  }

  /**
   * Calculate geographic distance between two coordinates using Haversine formula
   */
  private haversineDistance(coord1: [number, number], coord2: [number, number]): number {
    const R = 6371000; // Earth's radius in meters
    const lat1 = coord1[1] * Math.PI / 180;
    const lat2 = coord2[1] * Math.PI / 180;
    const deltaLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const deltaLon = (coord2[0] - coord1[0]) * Math.PI / 180;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Calculate total geographic distance for a path
   */
  private calculatePathDistance(partIds: string[]): number {
    let totalDistance = 0;

    for (const partId of partIds) {
      const part = this.parts.get(partId);
      if (!part) continue;

      // Calculate distance along this railway part
      for (let i = 0; i < part.coordinates.length - 1; i++) {
        totalDistance += this.haversineDistance(
          part.coordinates[i],
          part.coordinates[i + 1]
        );
      }
    }

    return totalDistance;
  }

  /**
   * Calculate bearing from coord1 to coord2 in degrees (0-360)
   */
  private calculateBearing(coord1: [number, number], coord2: [number, number]): number {
    const lon1 = coord1[0] * Math.PI / 180;
    const lon2 = coord2[0] * Math.PI / 180;
    const lat1 = coord1[1] * Math.PI / 180;
    const lat2 = coord2[1] * Math.PI / 180;

    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;

    return (bearing + 360) % 360; // Normalize to 0-360
  }

  /**
   * Orient a part correctly for path traversal
   * Returns [entry, exit] points where exit is where we leave to go to the next part
   */
  private getOrientedPartEndpoints(partId: string, prevPartId: string | null, nextPartId: string | null): [[number, number], [number, number]] | null {
    const part = this.parts.get(partId);
    if (!part) return null;

    const startKey = this.coordinateToKey(part.startPoint);
    const endKey = this.coordinateToKey(part.endPoint);

    // If we have a next part, orient so we exit toward it
    if (nextPartId) {
      const nextPart = this.parts.get(nextPartId);
      if (nextPart) {
        const nextStartKey = this.coordinateToKey(nextPart.startPoint);
        const nextEndKey = this.coordinateToKey(nextPart.endPoint);

        // Exit point connects to next part's entry
        if (endKey === nextStartKey || endKey === nextEndKey) {
          // End connects to next, so orient: start → end
          return [part.startPoint, part.endPoint];
        } else {
          // Start connects to next, so orient: end → start
          return [part.endPoint, part.startPoint];
        }
      }
    }

    // If no next part but have previous, orient so we entered from prev
    if (prevPartId) {
      const prevPart = this.parts.get(prevPartId);
      if (prevPart) {
        const prevStartKey = this.coordinateToKey(prevPart.startPoint);
        const prevEndKey = this.coordinateToKey(prevPart.endPoint);

        // Entry point connects to prev part's exit
        if (startKey === prevStartKey || startKey === prevEndKey) {
          // Start connects to prev, so orient: start → end
          return [part.startPoint, part.endPoint];
        } else {
          // End connects to prev, so orient: end → start
          return [part.endPoint, part.startPoint];
        }
      }
    }

    // No context, use default orientation
    return [part.startPoint, part.endPoint];
  }

  /**
   * Detect if a path has backtracking (tight "V" shapes)
   * Uses oriented parts to calculate accurate bearing changes
   */
  private hasBacktracking(partIds: string[]): boolean {
    if (partIds.length < 3) return false;

    for (let i = 0; i < partIds.length - 2; i++) {
      // Get oriented endpoints for three consecutive parts
      const oriented1 = this.getOrientedPartEndpoints(partIds[i], i > 0 ? partIds[i-1] : null, partIds[i+1]);
      const oriented2 = this.getOrientedPartEndpoints(partIds[i+1], partIds[i], partIds[i+2]);
      const oriented3 = this.getOrientedPartEndpoints(partIds[i+2], partIds[i+1], i+3 < partIds.length ? partIds[i+3] : null);

      if (!oriented1 || !oriented2 || !oriented3) continue;

      // Calculate bearings from entry to exit for each part
      const bearing1 = this.calculateBearing(oriented1[0], oriented1[1]);
      const bearing2 = this.calculateBearing(oriented2[0], oriented2[1]);
      const bearing3 = this.calculateBearing(oriented3[0], oriented3[1]);

      // Calculate angular changes between consecutive segments
      const diff1 = Math.abs(bearing2 - bearing1);
      const diff2 = Math.abs(bearing3 - bearing2);

      // Normalize to 0-180 range
      const normalizedDiff1 = diff1 > 180 ? 360 - diff1 : diff1;
      const normalizedDiff2 = diff2 > 180 ? 360 - diff2 : diff2;

      // If direction changes by more than 140 degrees, it's a backtrack
      if (normalizedDiff1 > 140 || normalizedDiff2 > 140) {
        console.log(`    ⚠️  BACKTRACKING DETECTED: ${normalizedDiff1 > 140 ? normalizedDiff1.toFixed(1) : normalizedDiff2.toFixed(1)}° > 140°`);
        return true;
      }
    }

    return false;
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
    this.splits.clear();
  }

  /**
   * Get the original part ID from a segment ID (e.g., "12345_seg0" -> "12345")
   * Returns the input if it's already an original part ID
   */
  public getOriginalPartId(partId: string): string {
    const part = this.parts.get(partId);
    if (part && part.originalPartId) {
      return part.originalPartId;
    }
    return partId;
  }

  /**
   * Check if a part ID represents a split segment
   */
  public isSplitSegment(partId: string): boolean {
    return partId.includes('_seg');
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

    // Step 1: Find shortest path using standard BFS
    const firstPath = this.findShortestPath(startId, endId);

    if (!firstPath) {
      return null; // No path found at all
    }

    // Step 2: Check if it backtracks
    if (!this.hasBacktracking(firstPath)) {
      // No backtracking - use it immediately
      return this.buildPathResult(firstPath);
    }

    // Step 3: Path backtracks - search for non-backtracking alternatives
    const firstDistance = this.calculatePathDistance(firstPath);
    const maxSearchDistance = firstDistance; // Don't search beyond original distance

    console.log(`  Searching for non-backtracking alternatives (max ${(maxSearchDistance / 1000).toFixed(1)}km)...`);

    const bestAlternative = this.findNonBacktrackingAlternative(
      startId,
      endId,
      maxSearchDistance
    );

    if (!bestAlternative) {
      console.log(`  No non-backtracking alternative found within ${(maxSearchDistance / 1000).toFixed(1)}km, using original`);
      return this.buildPathResult(firstPath);
    }

    // Step 4: Compare by geographic distance
    const altDistance = this.calculatePathDistance(bestAlternative);
    const maxAcceptable = Math.min(firstDistance * 1.1, firstDistance + 5000);

    if (altDistance <= maxAcceptable) {
      console.log(`  Using non-backtracking alternative (${(altDistance / 1000).toFixed(1)}km) over backtracking path (${(firstDistance / 1000).toFixed(1)}km)`);
      return this.buildPathResult(bestAlternative);
    }

    // Alternative doesn't backtrack but is too long
    console.log(`  Alternative is too long (${(altDistance / 1000).toFixed(1)}km vs ${(firstDistance / 1000).toFixed(1)}km), using original`);
    return this.buildPathResult(firstPath);
  }

  /**
   * Find shortest path using standard BFS with global visited set (fast)
   */
  private findShortestPath(startId: string, endId: string): string[] | null {
    const queue: { id: string; path: string[] }[] = [{ id: startId, path: [startId] }];
    const visited = new Set<string>([startId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const connected = this.getConnectedPartIds(current.id);

      for (const connectedId of connected) {
        if (connectedId === endId) {
          return [...current.path, connectedId];
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

    return null;
  }

  /**
   * Find non-backtracking path using BFS that checks for backtracking during exploration
   */
  private findPathWithoutBacktracking(startId: string, endId: string, maxDistance: number): string[] | null {
    const queue: { id: string; path: string[] }[] = [{ id: startId, path: [startId] }];
    const visited = new Set<string>([startId]);
    let shortestPath: string[] | null = null;
    let shortestDistance = Infinity;

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Check if current path already exceeds max distance
      if (current.path.length > 3) {
        const currentDistance = this.calculatePathDistance(current.path);
        if (currentDistance > maxDistance) {
          continue; // Skip this branch
        }
      }

      const connected = this.getConnectedPartIds(current.id);

      for (const connectedId of connected) {
        if (connectedId === endId) {
          // Found end - check final path
          const completePath = [...current.path, connectedId];

          // Check if this path has backtracking
          if (this.hasBacktracking(completePath)) {
            continue; // Reject this path
          }

          // Check distance
          const pathDistance = this.calculatePathDistance(completePath);
          if (pathDistance <= maxDistance && pathDistance < shortestDistance) {
            shortestPath = completePath;
            shortestDistance = pathDistance;
          }
          continue;
        }

        if (!visited.has(connectedId)) {
          const newPath = [...current.path, connectedId];

          // Check if adding this node would create backtracking (if we have enough nodes)
          if (newPath.length >= 3) {
            // Check the last 3 nodes for backtracking
            const lastThree = newPath.slice(-3);
            const tempPart1 = this.parts.get(lastThree[0]);
            const tempPart2 = this.parts.get(lastThree[1]);
            const tempPart3 = this.parts.get(lastThree[2]);

            if (tempPart1 && tempPart2 && tempPart3) {
              const oriented1 = this.getOrientedPartEndpoints(lastThree[0], newPath.length > 3 ? newPath[newPath.length - 4] : null, lastThree[1]);
              const oriented2 = this.getOrientedPartEndpoints(lastThree[1], lastThree[0], lastThree[2]);
              const oriented3 = this.getOrientedPartEndpoints(lastThree[2], lastThree[1], null);

              if (oriented1 && oriented2 && oriented3) {
                const bearing1 = this.calculateBearing(oriented1[0], oriented1[1]);
                const bearing2 = this.calculateBearing(oriented2[0], oriented2[1]);
                const bearing3 = this.calculateBearing(oriented3[0], oriented3[1]);

                const diff1 = Math.abs(bearing2 - bearing1);
                const diff2 = Math.abs(bearing3 - bearing2);
                const normalizedDiff1 = diff1 > 180 ? 360 - diff1 : diff1;
                const normalizedDiff2 = diff2 > 180 ? 360 - diff2 : diff2;

                // If this would create backtracking, skip this branch
                if (normalizedDiff1 > 140 || normalizedDiff2 > 140) {
                  continue; // Don't explore this path further
                }
              }
            }
          }

          visited.add(connectedId);
          queue.push({
            id: connectedId,
            path: newPath
          });
        }
      }
    }

    return shortestPath;
  }

  /**
   * Find non-backtracking alternative by trying different first hops
   */
  private findNonBacktrackingAlternative(
    startId: string,
    endId: string,
    maxDistance: number
  ): string[] | null {
    console.log(`  Trying to find path without backtracking`);

    // Try to find a non-backtracking path
    const path = this.findPathWithoutBacktracking(startId, endId, maxDistance);

    if (path && path.length > 1) {
      const distance = this.calculatePathDistance(path);
      console.log(`  ✓ Found non-backtracking path via ${path[1]} (${path.length} parts, ${(distance / 1000).toFixed(1)}km)`);
      return path;
    }

    return null;
  }

  private buildPathResult(partIds: string[]): PathResult {
    // Build a simple coordinate list by concatenating all part coordinates
    // Note: This is a fallback. In practice, the caller should use mergeLinearChain
    // from coordinateUtils.ts for proper coordinate ordering by fetching the actual
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
