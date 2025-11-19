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
          WHERE id::TEXT = $1 OR id::TEXT = $2
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
          id::TEXT as id,
          ST_AsGeoJSON(geometry) as geometry_json
        FROM railway_parts rp, search_area
        WHERE ST_Intersects(rp.geometry, search_area.buffer_geom)
          AND rp.geometry IS NOT NULL
        ORDER BY id
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

  /**
   * Load railway parts around a coordinate (for coordinate-based pathfinding)
   */
  async loadRailwayPartsAroundCoordinate(
    dbClient: Client | Pool,
    coordinate: [number, number],
    bufferMeters: number = 50000
  ): Promise<void> {
    let client: Client | PoolClient;
    let shouldRelease = false;

    if ('totalCount' in dbClient) {
      client = await (dbClient as Pool).connect();
      shouldRelease = true;
    } else {
      client = dbClient as Client;
    }

    try {
      const result = await client.query(`
        WITH search_area AS (
          SELECT ST_Transform(
            ST_Buffer(
              ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3857),
              $3
            ),
            4326
          ) as buffer_geom
        )
        SELECT
          id::TEXT as id,
          ST_AsGeoJSON(geometry) as geometry_json
        FROM railway_parts rp, search_area
        WHERE ST_Intersects(rp.geometry, search_area.buffer_geom)
          AND rp.geometry IS NOT NULL
        ORDER BY id
      `, [coordinate[0], coordinate[1], bufferMeters]);

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

          const startKey = this.coordinateToKey(startPoint);
          const endKey = this.coordinateToKey(endPoint);

          if (!this.coordToPartIds.has(startKey)) {
            this.coordToPartIds.set(startKey, []);
          }
          if (!this.coordToPartIds.has(endKey)) {
            this.coordToPartIds.set(endKey, []);
          }

          this.coordToPartIds.get(startKey)!.push(id);
          if (startKey !== endKey) {
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

  /**
   * Calculate distance from a point to a line segment
   */
  private pointToSegmentDistance(
    point: [number, number],
    segmentStart: [number, number],
    segmentEnd: [number, number]
  ): number {
    const x = point[0];
    const y = point[1];
    const x1 = segmentStart[0];
    const y1 = segmentStart[1];
    const x2 = segmentEnd[0];
    const y2 = segmentEnd[1];

    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) {
      param = dot / lenSq;
    }

    let xx, yy;

    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    return this.haversineDistance(point, [xx, yy]);
  }

  /**
   * Find all railway parts that contain a given coordinate (within tolerance)
   * Returns array of part IDs that contain the coordinate
   * Checks if coordinate lies on any segment of the part (not just vertices)
   */
  private findAllPartsContainingCoordinate(
    coordinate: [number, number],
    toleranceMeters: number = 50
  ): string[] {
    const matchingParts: string[] = [];

    for (const [partId, part] of this.parts) {
      // Check if coordinate lies on any segment of this part
      for (let i = 0; i < part.coordinates.length - 1; i++) {
        const dist = this.pointToSegmentDistance(
          coordinate,
          part.coordinates[i],
          part.coordinates[i + 1]
        );
        if (dist <= toleranceMeters) {
          matchingParts.push(partId);
          break; // Found match for this part, move to next part
        }
      }
    }

    return matchingParts;
  }

  /**
   * Find which endpoint (first or last vertex) of a part is closest to a coordinate
   * Returns the index (0 for first, length-1 for last) and the distance
   */
  private findClosestEndpoint(
    partId: string,
    coordinate: [number, number]
  ): { index: number; distance: number } | null {
    const part = this.parts.get(partId);
    if (!part) return null;

    const firstDist = this.haversineDistance(coordinate, part.coordinates[0]);
    const lastDist = this.haversineDistance(coordinate, part.coordinates[part.coordinates.length - 1]);

    if (firstDist < lastDist) {
      return { index: 0, distance: firstDist };
    } else {
      return { index: part.coordinates.length - 1, distance: lastDist };
    }
  }

  /**
   * Find the nearest point on a part to a given coordinate
   * Returns the segment index and the projected point on that segment
   */
  private findNearestPointOnPart(
    partId: string,
    coordinate: [number, number]
  ): { segmentIndex: number; projectedPoint: [number, number]; distance: number } | null {
    const part = this.parts.get(partId);
    if (!part) return null;

    let minDistance = Infinity;
    let bestSegmentIndex = -1;
    let bestProjectedPoint: [number, number] = [0, 0];

    // Check each segment
    for (let i = 0; i < part.coordinates.length - 1; i++) {
      const x = coordinate[0];
      const y = coordinate[1];
      const x1 = part.coordinates[i][0];
      const y1 = part.coordinates[i][1];
      const x2 = part.coordinates[i + 1][0];
      const y2 = part.coordinates[i + 1][1];

      const A = x - x1;
      const B = y - y1;
      const C = x2 - x1;
      const D = y2 - y1;

      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      let param = -1;

      if (lenSq !== 0) {
        param = dot / lenSq;
      }

      let xx, yy;

      if (param < 0) {
        xx = x1;
        yy = y1;
      } else if (param > 1) {
        xx = x2;
        yy = y2;
      } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
      }

      const dist = this.haversineDistance(coordinate, [xx, yy]);
      if (dist < minDistance) {
        minDistance = dist;
        bestSegmentIndex = i;
        bestProjectedPoint = [xx, yy];
      }
    }

    if (bestSegmentIndex === -1) return null;

    return {
      segmentIndex: bestSegmentIndex,
      projectedPoint: bestProjectedPoint,
      distance: minDistance
    };
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
   * Find path from start coordinate to end coordinate with automatic retry using larger buffers
   * This is the new coordinate-based pathfinding method
   *
   * Algorithm:
   * 1. Find all parts that contain the start coordinate (within 1m tolerance)
   * 2. Find all parts that contain the end coordinate (within 1m tolerance)
   * 3. For each combination of (start part, end part), run part-based pathfinding
   * 4. If truncateEdges=false (migrated routes): include entire parts (no truncation)
   *    If truncateEdges=true (new routes): trim edge parts from click point to connection
   * 5. Select the shortest path among all candidates
   *
   * This ensures coordinate-based and part-based pathfinding produce identical results
   * for migrated routes (where coordinates are at part endpoints).
   *
   * @param truncateEdges - If false: migrated routes (include entire parts)
   *                        If true: new routes (truncate edges from click points)
   */
  async findPathFromCoordinates(
    dbClient: Client | Pool,
    startCoordinate: [number, number],
    endCoordinate: [number, number],
    truncateEdges: boolean = true
  ): Promise<PathResult | null> {
    const buffers = [50000, 100000, 150000]; // 50km, 100km, 150km

    for (const bufferMeters of buffers) {
      console.log(`Attempting coordinate-based pathfinding with ${bufferMeters / 1000}km buffer...`);

      // Clear previous data
      this.clear();

      // Load parts around both coordinates
      await this.loadRailwayPartsAroundCoordinate(dbClient, startCoordinate, bufferMeters);
      await this.loadRailwayPartsAroundCoordinate(dbClient, endCoordinate, bufferMeters);

      // Find ALL parts containing the start coordinate (1m tolerance for exact match)
      const startPartIds = this.findAllPartsContainingCoordinate(startCoordinate, 1);

      // Find ALL parts containing the end coordinate (1m tolerance for exact match)
      const endPartIds = this.findAllPartsContainingCoordinate(endCoordinate, 1);

      if (startPartIds.length === 0) {
        console.log(`Start coordinate not found on any part (buffer: ${bufferMeters / 1000}km)`);
        continue;
      }

      if (endPartIds.length === 0) {
        console.log(`End coordinate not found on any part (buffer: ${bufferMeters / 1000}km)`);
        continue;
      }

      console.log(`Found ${startPartIds.length} start part(s): ${startPartIds.join(', ')}`);
      console.log(`Found ${endPartIds.length} end part(s): ${endPartIds.join(', ')}`);

      // Try all combinations of start and end parts
      let bestResult: PathResult | null = null;
      let bestDistance = Infinity;

      for (const startPartId of startPartIds) {
        for (const endPartId of endPartIds) {
          console.log(`  Trying path: ${startPartId} → ${endPartId}`);

          // Use existing part-based pathfinding (deterministic)
          const pathResult = this.findPath(startPartId, endPartId);

          if (!pathResult) {
            console.log(`    No path found`);
            continue;
          }

          console.log(`    Path found with ${pathResult.partIds.length} parts`);

          // Calculate coordinates for this path
          let coordinates: [number, number][];

          if (truncateEdges) {
            // NEW ROUTE LOGIC: Truncate edge parts from click points to connections
            coordinates = this.buildCoordinatesWithTruncation(
              pathResult.partIds,
              startCoordinate,
              endCoordinate
            );
          } else {
            // MIGRATED ROUTE LOGIC: Use entire parts (no truncation)
            // This ensures identical results to old part-based pathfinding
            const coordinateSublists: [number, number][][] = [];
            for (const partId of pathResult.partIds) {
              const part = this.parts.get(partId);
              if (part) {
                coordinateSublists.push(part.coordinates);
              }
            }
            coordinates = this.mergeLinearChain(coordinateSublists);
          }

          // Calculate total distance
          let distance = 0;
          for (let i = 0; i < coordinates.length - 1; i++) {
            distance += this.haversineDistance(coordinates[i], coordinates[i + 1]);
          }

          console.log(`    Distance: ${(distance / 1000).toFixed(2)} km`);

          // Keep track of shortest path
          if (distance < bestDistance) {
            bestDistance = distance;
            bestResult = {
              partIds: pathResult.partIds,
              coordinates
            };
          }
        }
      }

      if (bestResult) {
        console.log(`Selected shortest path: ${(bestDistance / 1000).toFixed(2)} km`);
        return bestResult;
      }

      console.log(`No valid path found (buffer: ${bufferMeters / 1000}km)`);
    }

    // No path found even with largest buffer
    console.log('No path found with any buffer size');
    return null;
  }

  /**
   * Build coordinates with edge truncation for new routes
   * Trims the first and last parts from the click points to their connections
   */
  private buildCoordinatesWithTruncation(
    partIds: string[],
    startCoordinate: [number, number],
    endCoordinate: [number, number]
  ): [number, number][] {
    if (partIds.length === 0) return [];

    // Special case: single part
    if (partIds.length === 1) {
      const part = this.parts.get(partIds[0]);
      if (!part) return [];

      // Find nearest points on the part for start and end coordinates
      const startPoint = this.findNearestPointOnPart(partIds[0], startCoordinate);
      const endPoint = this.findNearestPointOnPart(partIds[0], endCoordinate);

      if (!startPoint || !endPoint) return part.coordinates;

      // Build coordinate list from start to end
      const coordinates: [number, number][] = [];

      if (startPoint.segmentIndex === endPoint.segmentIndex) {
        // Both points on the same segment
        coordinates.push(startPoint.projectedPoint);
        coordinates.push(endPoint.projectedPoint);
      } else if (startPoint.segmentIndex < endPoint.segmentIndex) {
        // Start before end
        coordinates.push(startPoint.projectedPoint);
        // Add all vertices between start and end segments
        for (let i = startPoint.segmentIndex + 1; i <= endPoint.segmentIndex; i++) {
          coordinates.push(part.coordinates[i]);
        }
        coordinates.push(endPoint.projectedPoint);
      } else {
        // End before start - reverse direction
        coordinates.push(startPoint.projectedPoint);
        // Add all vertices between (in reverse)
        for (let i = startPoint.segmentIndex; i > endPoint.segmentIndex; i--) {
          coordinates.push(part.coordinates[i]);
        }
        coordinates.push(endPoint.projectedPoint);
      }

      return coordinates;
    }

    // Multi-part path: truncate first and last parts
    const coordinateSublists: [number, number][][] = [];

    for (let i = 0; i < partIds.length; i++) {
      const partId = partIds[i];
      const part = this.parts.get(partId);
      if (!part) continue;

      if (i === 0) {
        // First part: truncate from start coordinate to connection with next part
        const nextPartId = partIds[1];
        const nextPart = this.parts.get(nextPartId);
        if (!nextPart) {
          coordinateSublists.push(part.coordinates);
          continue;
        }

        // Find which endpoint of this part connects to next part
        const endKey = this.coordinateToKey(part.endPoint);
        const startKey = this.coordinateToKey(part.startPoint);
        const nextStartKey = this.coordinateToKey(nextPart.startPoint);
        const nextEndKey = this.coordinateToKey(nextPart.endPoint);

        const endsConnect = (endKey === nextStartKey || endKey === nextEndKey);

        // Find nearest point on part for start coordinate
        const startPoint = this.findNearestPointOnPart(partId, startCoordinate);
        if (!startPoint) {
          coordinateSublists.push(part.coordinates);
          continue;
        }

        // Build coordinates from start point to connection endpoint
        const truncated: [number, number][] = [];
        truncated.push(startPoint.projectedPoint);

        if (endsConnect) {
          // Go from start point to end of part
          for (let j = startPoint.segmentIndex + 1; j < part.coordinates.length; j++) {
            truncated.push(part.coordinates[j]);
          }
        } else {
          // Go from start point to start of part (reverse)
          for (let j = startPoint.segmentIndex; j >= 0; j--) {
            truncated.push(part.coordinates[j]);
          }
        }

        coordinateSublists.push(truncated);

      } else if (i === partIds.length - 1) {
        // Last part: truncate from connection with previous part to end coordinate
        const prevPartId = partIds[i - 1];
        const prevPart = this.parts.get(prevPartId);
        if (!prevPart) {
          coordinateSublists.push(part.coordinates);
          continue;
        }

        // Find which endpoint of this part connects to previous part
        const startKey = this.coordinateToKey(part.startPoint);
        const endKey = this.coordinateToKey(part.endPoint);
        const prevStartKey = this.coordinateToKey(prevPart.startPoint);
        const prevEndKey = this.coordinateToKey(prevPart.endPoint);

        const startsConnect = (startKey === prevStartKey || startKey === prevEndKey);

        // Find nearest point on part for end coordinate
        const endPoint = this.findNearestPointOnPart(partId, endCoordinate);
        if (!endPoint) {
          coordinateSublists.push(part.coordinates);
          continue;
        }

        // Build coordinates from connection endpoint to end point
        const truncated: [number, number][] = [];

        if (startsConnect) {
          // Go from start of part to end point
          for (let j = 0; j <= endPoint.segmentIndex; j++) {
            truncated.push(part.coordinates[j]);
          }
        } else {
          // Go from end of part to end point (reverse)
          for (let j = part.coordinates.length - 1; j > endPoint.segmentIndex; j--) {
            truncated.push(part.coordinates[j]);
          }
        }

        truncated.push(endPoint.projectedPoint);
        coordinateSublists.push(truncated);

      } else {
        // Middle part: use entire part
        coordinateSublists.push(part.coordinates);
      }
    }

    // Merge and orient all coordinate sublists
    return this.mergeLinearChain(coordinateSublists);
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
    // Build coordinate sublists (one per part)
    const coordinateSublists: [number, number][][] = [];

    for (const partId of partIds) {
      const part = this.parts.get(partId);
      if (part) {
        coordinateSublists.push(part.coordinates);
      }
    }

    // Use mergeLinearChain to properly orient and connect the coordinate sublists
    const coordinates = this.mergeLinearChain(coordinateSublists);

    return {
      partIds,
      coordinates
    };
  }

  /**
   * Merges a list of coordinate sublists into a single linear chain.
   * This ensures proper orientation and removes duplicate connection points.
   * Based on the algorithm from coordinateUtils.ts but kept here to avoid circular dependencies.
   */
  private mergeLinearChain(sublists: [number, number][][]): [number, number][] {
    if (sublists.length === 0) return [];
    if (sublists.length === 1) return sublists[0];

    // Make a copy to avoid mutating the original
    const remainingSublists = sublists.map(s => [...s]);

    // Step 1: Create a map of coordinate frequencies (only count endpoints)
    const coordCount = new Map<string, number>();
    remainingSublists.forEach(sublist => {
      const firstKey = `${sublist[0][0]},${sublist[0][1]}`;
      const lastKey = `${sublist[sublist.length - 1][0]},${sublist[sublist.length - 1][1]}`;
      coordCount.set(firstKey, (coordCount.get(firstKey) || 0) + 1);
      coordCount.set(lastKey, (coordCount.get(lastKey) || 0) + 1);
    });

    // Step 2: Find the starting sublist (prefer one with an endpoint that appears only once)
    let startingSublistIndex = remainingSublists.findIndex(sublist => {
      const firstCoord = `${sublist[0][0]},${sublist[0][1]}`;
      const lastCoord = `${sublist[sublist.length - 1][0]},${sublist[sublist.length - 1][1]}`;
      return coordCount.get(firstCoord) === 1 || coordCount.get(lastCoord) === 1;
    });

    // If no clear endpoint found (e.g., circular routes or complex junctions), use first sublist
    if (startingSublistIndex === -1) {
      console.log('[RailwayPathFinder] No clear endpoint found, using first sublist as starting point');
      startingSublistIndex = 0;
    }

    // Extract the starting sublist
    const mergedChain = [...remainingSublists[startingSublistIndex]];
    remainingSublists.splice(startingSublistIndex, 1);

    // Step 2.1: Orient the starting sublist correctly if we have a clear endpoint
    const firstCoord = `${mergedChain[0][0]},${mergedChain[0][1]}`;
    const lastCoord = `${mergedChain[mergedChain.length - 1][0]},${mergedChain[mergedChain.length - 1][1]}`;

    // If the last coordinate appears only once, it should be at the end
    // If the first coordinate appears only once, it should be at the start (don't reverse)
    if (coordCount.get(lastCoord) === 1 && coordCount.get(firstCoord) !== 1) {
      // Last coord is endpoint, first coord is not -> need to reverse
      mergedChain.reverse();
    }

    // Step 3: Build the chain incrementally
    while (remainingSublists.length > 0) {
      const lastCoordInChain = mergedChain[mergedChain.length - 1];

      // Find the next sublist that connects to the current chain
      const nextIndex = remainingSublists.findIndex(sublist =>
        sublist.some(([x, y]) => x === lastCoordInChain[0] && y === lastCoordInChain[1])
      );

      if (nextIndex === -1) {
        throw new Error("Chain is broken; no connecting sublist found.");
      }

      // Extract the next sublist and reverse it if necessary
      const nextSublist = [...remainingSublists[nextIndex]];
      const overlapIndex = nextSublist.findIndex(([x, y]) => x === lastCoordInChain[0] && y === lastCoordInChain[1]);

      if (overlapIndex !== 0) {
        nextSublist.reverse(); // Reverse if the overlap is not at the start
      }

      // Add the non-overlapping part of the sublist to the chain
      mergedChain.push(...nextSublist.slice(1));

      // Remove the processed sublist
      remainingSublists.splice(nextIndex, 1);
    }

    return mergedChain;
  }
}
