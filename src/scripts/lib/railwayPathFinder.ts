import { Client, Pool, PoolClient } from 'pg';
import type { PathResult } from '../../lib/types';
import { calculateBearing } from '../../lib/geoUtils';

export type { PathResult };

interface RailwayPart {
  id: string;
  coordinates: [number, number][];
  startPoint: [number, number];
  endPoint: [number, number];
}

interface PointOnSegment {
  projectedPoint: [number, number];
  distance: number;
}

interface NearestPointResult extends PointOnSegment {
  segmentIndex: number;
}

/**
 * RailwayPathFinder: BFS-based pathfinding for railway networks
 *
 * Features:
 * - Part-based pathfinding (between railway part IDs)
 * - Coordinate-based pathfinding (between GPS coordinates)
 * - Backtracking detection and avoidance
 * - Progressive buffer retry (50km → 100km → 222km)
 * - Edge truncation for coordinate-based routes
 */
export class RailwayPathFinder {
  private parts: Map<string, RailwayPart> = new Map();
  private coordToPartIds: Map<string, string[]> = new Map();

  // ============================================================================
  // DATABASE LOADING
  // ============================================================================

  /**
   * Load railway parts around start and end part IDs with buffer
   */
  async loadRailwayParts(
    dbClient: Client | Pool,
    startId: string,
    endId: string,
    bufferMeters: number = 50000
  ): Promise<void> {
    const client = await this.getClient(dbClient);

    try {
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

      this.parseAndStoreParts(result.rows);
    } finally {
      this.releaseClient(dbClient, client);
    }
  }

  /**
   * Load railway parts around a coordinate with buffer
   */
  async loadRailwayPartsAroundCoordinate(
    dbClient: Client | Pool,
    coordinate: [number, number],
    bufferMeters: number = 50000
  ): Promise<void> {
    const client = await this.getClient(dbClient);

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

      this.parseAndStoreParts(result.rows);
    } finally {
      this.releaseClient(dbClient, client);
    }
  }

  /**
   * Clear all loaded railway parts data
   */
  clear(): void {
    this.parts.clear();
    this.coordToPartIds.clear();
  }

  // ============================================================================
  // PART-BASED PATHFINDING
  // ============================================================================

  /**
   * Find path between two railway part IDs
   *
   * Algorithm:
   * 1. Find shortest path using BFS
   * 2. Check if it backtracks
   * 3. If backtracking, search for non-backtracking alternative
   * 4. Compare alternatives and choose best
   */
  findPath(startId: string, endId: string): PathResult | null {
    if (!this.parts.has(startId) || !this.parts.has(endId)) {
      return null;
    }

    if (startId === endId) {
      const part = this.parts.get(startId)!;
      return { partIds: [startId], coordinates: part.coordinates, hasBacktracking: false };
    }

    // Step 1: Find shortest path using standard BFS
    const firstPath = this.findShortestPath(startId, endId);
    if (!firstPath) {
      return null;
    }

    // Step 2: Check if it backtracks
    if (!this.hasBacktracking(firstPath)) {
      const result = this.buildPathResult(firstPath);
      result.hasBacktracking = false;
      return result;
    }

    // Step 3: Search for non-backtracking alternative
    const firstDistance = this.calculatePathDistance(firstPath);
    // Allow searching for paths up to 10% longer or +5km (non-backtracking paths are often slightly longer)
    const searchDistance = Math.min(firstDistance * 1.1, firstDistance + 5000);
    console.log(`  Searching for non-backtracking alternatives (max ${(searchDistance / 1000).toFixed(1)}km)...`);

    const bestAlternative = this.findNonBacktrackingAlternative(
      startId,
      endId,
      searchDistance
    );

    if (!bestAlternative) {
      console.log(`  No non-backtracking alternative found, using original`);
      const result = this.buildPathResult(firstPath);
      result.hasBacktracking = true;
      return result;
    }

    // Step 4: Compare by distance
    const altDistance = this.calculatePathDistance(bestAlternative);
    const maxAcceptable = Math.min(firstDistance * 1.1, firstDistance + 5000);

    if (altDistance <= maxAcceptable) {
      console.log(`  Using non-backtracking alternative (${(altDistance / 1000).toFixed(1)}km) over backtracking path (${(firstDistance / 1000).toFixed(1)}km)`);

      // Try to build the path - if it fails due to chain break, use original
      try {
        const result = this.buildPathResult(bestAlternative);
        result.hasBacktracking = false;
        return result;
      } catch (error) {
        console.log(`  ⚠️  Alternative path has broken chain, using backtracking path instead`);
        const result = this.buildPathResult(firstPath);
        result.hasBacktracking = true;
        return result;
      }
    }

    console.log(`  Alternative is too long (${(altDistance / 1000).toFixed(1)}km vs ${(firstDistance / 1000).toFixed(1)}km), using original`);
    const result = this.buildPathResult(firstPath);
    result.hasBacktracking = true;
    return result;
  }

  // ============================================================================
  // COORDINATE-BASED PATHFINDING
  // ============================================================================

  /**
   * Find path from start coordinate to end coordinate with automatic retry
   *
   * Algorithm:
   * 1. Find all parts containing start/end coordinates
   * 2. Try pathfinding for each (start part, end part) combination
   * 3. Truncate edge parts from click points to connections
   * 4. Select shortest path
   */
  async findPathFromCoordinates(
    dbClient: Client | Pool,
    startCoordinate: [number, number],
    endCoordinate: [number, number]
  ): Promise<PathResult | null> {
    const buffers = [50000, 100000, 222000]; // 50km, 100km, 222km

    for (const bufferMeters of buffers) {
      console.log(`Attempting coordinate-based pathfinding with ${bufferMeters / 1000}km buffer...`);
      this.clear();

      // Load parts around both coordinates
      await this.loadRailwayPartsAroundCoordinate(dbClient, startCoordinate, bufferMeters);
      await this.loadRailwayPartsAroundCoordinate(dbClient, endCoordinate, bufferMeters);

      // Find parts containing the coordinates (1m tolerance)
      const startPartIds = this.findAllPartsContainingCoordinate(startCoordinate, 1);
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

      // Try all combinations
      const bestResult = this.findBestCoordinatePath(
        startPartIds,
        endPartIds,
        startCoordinate,
        endCoordinate
      );

      if (bestResult) {
        return bestResult;
      }

      console.log(`No valid path found (buffer: ${bufferMeters / 1000}km)`);
    }

    console.log('No path found with any buffer size');
    return null;
  }

  // ============================================================================
  // BFS SEARCH ALGORITHMS
  // ============================================================================

  /**
   * Find shortest path using standard BFS with global visited set
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
   * Find non-backtracking path using BFS with backtracking rejection
   * Optionally forces a specific first hop for retry logic
   *
   * Uses best-distance tracking instead of global visited to allow alternative paths.
   */
  private findPathWithoutBacktracking(
    startId: string,
    endId: string,
    maxDistance: number,
    forcedFirstHop?: string
  ): string[] | null {
    const queue: { id: string; path: string[]; distance: number }[] = [{
      id: startId,
      path: [startId],
      distance: 0
    }];

    const bestDistance = new Map<string, number>();
    bestDistance.set(startId, 0);

    let shortestPath: string[] | null = null;
    let shortestPathDistance = Infinity;

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Skip if we already found a better path to this node
      const currentBest = bestDistance.get(current.id);
      if (currentBest !== undefined && current.distance > currentBest) {
        continue;
      }

      // Prune if exceeding max distance
      if (current.distance > maxDistance) {
        continue;
      }

      const connected = this.getConnectedPartIds(current.id);

      for (const connectedId of connected) {
        // Enforce forced first hop if specified
        if (current.id === startId && forcedFirstHop && connectedId !== forcedFirstHop) {
          continue;
        }

        // Prevent cycles in current path
        if (current.path.includes(connectedId)) {
          continue;
        }

        // Check if we reached the end
        if (connectedId === endId) {
          const completePath = [...current.path, connectedId];

          if (this.hasBacktracking(completePath)) {
            continue;
          }

          const pathDistance = this.calculatePathDistance(completePath);
          if (pathDistance <= maxDistance && pathDistance < shortestPathDistance) {
            shortestPath = completePath;
            shortestPathDistance = pathDistance;
          }
          continue;
        }

        const newPath = [...current.path, connectedId];

        // Reject if adding this node creates backtracking
        if (this.wouldCreateBacktracking(newPath)) {
          continue;
        }

        // Calculate distance efficiently (only add new segment)
        const connectedPart = this.parts.get(connectedId);
        if (!connectedPart) continue;

        let segmentDist = 0;
        for (let i = 0; i < connectedPart.coordinates.length - 1; i++) {
          segmentDist += this.haversineDistance(
            connectedPart.coordinates[i],
            connectedPart.coordinates[i + 1]
          );
        }
        const newDistance = current.distance + segmentDist;

        // Only explore if this is best path to this node so far
        const bestToNode = bestDistance.get(connectedId);
        if (bestToNode === undefined || newDistance < bestToNode) {
          bestDistance.set(connectedId, newDistance);
          queue.push({
            id: connectedId,
            path: newPath,
            distance: newDistance
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
    console.log(`  Trying to find path without backtracking...`);

    // First attempt: no forced first hop
    let path = this.findPathWithoutBacktracking(startId, endId, maxDistance);
    if (path) {
      const distance = this.calculatePathDistance(path);
      console.log(`  ✓ Found non-backtracking path via ${path[1]} (${path.length} parts, ${(distance / 1000).toFixed(1)}km)`);
      return path;
    }

    // Retry with each possible first hop
    console.log(`  First attempt found no path, trying different starting branches...`);
    const firstHops = this.getConnectedPartIds(startId);

    for (const firstHop of firstHops) {
      path = this.findPathWithoutBacktracking(startId, endId, maxDistance, firstHop);
      if (path) {
        const distance = this.calculatePathDistance(path);
        console.log(`  ✓ Found non-backtracking path via ${firstHop} on retry (${path.length} parts, ${(distance / 1000).toFixed(1)}km)`);
        return path;
      }
    }

    console.log(`  No non-backtracking path found after ${firstHops.length + 1} attempts`);
    return null;
  }

  // ============================================================================
  // BACKTRACKING DETECTION
  // ============================================================================

  /**
   * Check if adding the last node to a path would create backtracking
   */
  private wouldCreateBacktracking(path: string[]): boolean {
    if (path.length < 2) return false;

    const currentIdx = path.length - 2;
    const prevPartId = currentIdx > 0 ? path[currentIdx - 1] : null;
    const currentPartId = path[currentIdx];
    const nextPartId = path[currentIdx + 1];

    const exitSegment = this.getConnectionSegment(currentPartId, prevPartId, nextPartId, true);
    const entrySegment = this.getConnectionSegment(nextPartId, currentPartId, null, false);

    if (!exitSegment || !entrySegment) return false;

    const exitBearing = calculateBearing(exitSegment[0], exitSegment[1]);
    const entryBearing = calculateBearing(entrySegment[0], entrySegment[1]);

    const diff = Math.abs(entryBearing - exitBearing);
    const normalizedDiff = diff > 180 ? 360 - diff : diff;

    return normalizedDiff > 140;
  }

  /**
   * Check if a path has backtracking (tight "V" shapes)
   * Uses segments near connection points for accurate bearing calculations
   */
  private hasBacktracking(partIds: string[]): boolean {
    if (partIds.length < 2) return false;

    for (let i = 0; i < partIds.length - 1; i++) {
      const prevPartId = i > 0 ? partIds[i - 1] : null;
      const currentPartId = partIds[i];
      const nextPartId = partIds[i + 1];
      const afterNextPartId = i + 2 < partIds.length ? partIds[i + 2] : null;

      // Get exit segment of current part (where it connects to next)
      const exitSegment = this.getConnectionSegment(currentPartId, prevPartId, nextPartId, true);

      // Get entry segment of next part (where it connects from current)
      const entrySegment = this.getConnectionSegment(nextPartId, currentPartId, afterNextPartId, false);

      if (!exitSegment || !entrySegment) continue;

      const exitBearing = calculateBearing(exitSegment[0], exitSegment[1]);
      const entryBearing = calculateBearing(entrySegment[0], entrySegment[1]);

      const diff = Math.abs(entryBearing - exitBearing);
      const normalizedDiff = diff > 180 ? 360 - diff : diff;

      if (normalizedDiff > 140) {
        console.log(`    ⚠️  BACKTRACKING DETECTED at ${currentPartId}→${nextPartId}: ${normalizedDiff.toFixed(1)}° > 140°`);
        return true;
      }
    }

    return false;
  }

  /**
   * Get the segment coordinates near a connection point for bearing calculation
   *
   * @param isExit - If true, returns segment near where we EXIT. If false, returns entry segment.
   */
  private getConnectionSegment(
    partId: string,
    prevPartId: string | null,
    nextPartId: string | null,
    isExit: boolean
  ): [[number, number], [number, number]] | null {
    const part = this.parts.get(partId);
    if (!part || part.coordinates.length < 2) return null;

    const coords = part.coordinates;
    const isForward = this.isPartTraversedForward(partId, prevPartId, nextPartId);

    if (isExit) {
      // Segment near where we EXIT this part
      if (isForward) {
        return [coords[coords.length - 2], coords[coords.length - 1]];
      } else {
        return [coords[1], coords[0]];
      }
    } else {
      // Segment near where we ENTER this part
      if (isForward) {
        return [coords[0], coords[1]];
      } else {
        return [coords[coords.length - 1], coords[coords.length - 2]];
      }
    }
  }

  /**
   * Determine if a part should be traversed forward (first→last) or backward (last→first)
   */
  private isPartTraversedForward(
    partId: string,
    prevPartId: string | null,
    nextPartId: string | null
  ): boolean {
    const part = this.parts.get(partId);
    if (!part) return true;

    const startKey = this.coordinateToKey(part.startPoint);
    const endKey = this.coordinateToKey(part.endPoint);

    // Determine orientation based on next part
    if (nextPartId) {
      const nextPart = this.parts.get(nextPartId);
      if (nextPart) {
        const nextStartKey = this.coordinateToKey(nextPart.startPoint);
        const nextEndKey = this.coordinateToKey(nextPart.endPoint);

        // If end connects to next, we're going forward
        if (endKey === nextStartKey || endKey === nextEndKey) {
          return true;
        } else {
          return false;
        }
      }
    }

    // Determine orientation based on previous part
    if (prevPartId) {
      const prevPart = this.parts.get(prevPartId);
      if (prevPart) {
        const prevStartKey = this.coordinateToKey(prevPart.startPoint);
        const prevEndKey = this.coordinateToKey(prevPart.endPoint);

        // If start connects to prev, we're going forward
        if (startKey === prevStartKey || startKey === prevEndKey) {
          return true;
        } else {
          return false;
        }
      }
    }

    return true; // Default: forward
  }

  // ============================================================================
  // COORDINATE GEOMETRY
  // ============================================================================

  /**
   * Find all railway parts containing a coordinate (within tolerance)
   * Checks if coordinate lies on any segment, not just vertices
   */
  private findAllPartsContainingCoordinate(
    coordinate: [number, number],
    toleranceMeters: number = 50
  ): string[] {
    const matchingParts: string[] = [];

    for (const [partId, part] of this.parts) {
      for (let i = 0; i < part.coordinates.length - 1; i++) {
        const dist = this.pointToSegmentDistance(
          coordinate,
          part.coordinates[i],
          part.coordinates[i + 1]
        );
        if (dist <= toleranceMeters) {
          matchingParts.push(partId);
          break;
        }
      }
    }

    return matchingParts;
  }

  /**
   * Find nearest point on a part to a coordinate
   * Returns segment index, projected point, and distance
   */
  private findNearestPointOnPart(
    partId: string,
    coordinate: [number, number]
  ): NearestPointResult | null {
    const part = this.parts.get(partId);
    if (!part) return null;

    let minDistance = Infinity;
    let bestSegmentIndex = -1;
    let bestProjectedPoint: [number, number] = [0, 0];

    for (let i = 0; i < part.coordinates.length - 1; i++) {
      const projection = this.projectPointOnSegment(
        coordinate,
        part.coordinates[i],
        part.coordinates[i + 1]
      );

      if (projection.distance < minDistance) {
        minDistance = projection.distance;
        bestSegmentIndex = i;
        bestProjectedPoint = projection.projectedPoint;
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
   * Find best path among all start/end part combinations for coordinate-based routing
   */
  private findBestCoordinatePath(
    startPartIds: string[],
    endPartIds: string[],
    startCoordinate: [number, number],
    endCoordinate: [number, number]
  ): PathResult | null {
    let bestResult: PathResult | null = null;
    let bestDistance = Infinity;

    for (const startPartId of startPartIds) {
      for (const endPartId of endPartIds) {
        console.log(`  Trying path: ${startPartId} → ${endPartId}`);

        const pathResult = this.findPath(startPartId, endPartId);
        if (!pathResult) {
          console.log(`    No path found`);
          continue;
        }

        console.log(`    Path found with ${pathResult.partIds.length} parts`);

        // Build coordinates with edge truncation
        let coordinates: [number, number][];
        try {
          coordinates = this.buildCoordinatesWithTruncation(
            pathResult.partIds,
            startCoordinate,
            endCoordinate
          );
        } catch (error) {
          // Chain is broken - this path doesn't connect properly
          console.log(`    ❌ Chain broken - skipping this combination`);
          continue;
        }

        // Calculate total distance
        const distance = this.calculateCoordinateDistance(coordinates);
        console.log(`    Distance: ${(distance / 1000).toFixed(2)} km`);

        // Selection logic: prefer non-backtracking paths when distances are close
        const isSameDistance = Math.abs(distance - bestDistance) < 10; // 10 meters tolerance
        const replacingGoodWithBad = bestResult && !bestResult.hasBacktracking && pathResult.hasBacktracking;
        const betterQuality = bestResult?.hasBacktracking && !pathResult.hasBacktracking;

        // Update if:
        // 1. No best result yet, OR
        // 2. Shorter distance (but not if replacing non-backtracking with backtracking when close), OR
        // 3. Same distance and better quality (non-backtracking over backtracking)
        const shouldUpdate = !bestResult ||
          (distance < bestDistance && !(isSameDistance && replacingGoodWithBad)) ||
          (isSameDistance && betterQuality);

        if (shouldUpdate) {
          bestDistance = distance;
          bestResult = {
            partIds: pathResult.partIds,
            coordinates,
            hasBacktracking: pathResult.hasBacktracking,
          };
        }
      }
    }

    if (bestResult) {
      console.log(`Selected shortest path: ${(bestDistance / 1000).toFixed(2)} km`);
    }

    return bestResult;
  }

  /**
   * Build coordinates with edge truncation for coordinate-based routes
   * Trims first and last parts from click points to their connections
   */
  private buildCoordinatesWithTruncation(
    partIds: string[],
    startCoordinate: [number, number],
    endCoordinate: [number, number]
  ): [number, number][] {
    if (partIds.length === 0) return [];

    // Special case: single part
    if (partIds.length === 1) {
      return this.buildSinglePartCoordinates(partIds[0], startCoordinate, endCoordinate);
    }

    // Multi-part path: truncate first and last parts
    const coordinateSublists: [number, number][][] = [];

    for (let i = 0; i < partIds.length; i++) {
      const partId = partIds[i];
      const part = this.parts.get(partId);
      if (!part) continue;

      if (i === 0) {
        // First part: truncate from start coordinate to connection
        const truncated = this.buildFirstPartCoordinates(partId, partIds[1], startCoordinate);
        coordinateSublists.push(truncated);
      } else if (i === partIds.length - 1) {
        // Last part: truncate from connection to end coordinate
        const truncated = this.buildLastPartCoordinates(partId, partIds[i - 1], endCoordinate);
        coordinateSublists.push(truncated);
      } else {
        // Middle part: use entire part
        coordinateSublists.push(part.coordinates);
      }
    }

    return this.mergeLinearChain(coordinateSublists);
  }

  /**
   * Build coordinates for a single-part route
   */
  private buildSinglePartCoordinates(
    partId: string,
    startCoordinate: [number, number],
    endCoordinate: [number, number]
  ): [number, number][] {
    const part = this.parts.get(partId);
    if (!part) return [];

    const startPoint = this.findNearestPointOnPart(partId, startCoordinate);
    const endPoint = this.findNearestPointOnPart(partId, endCoordinate);

    if (!startPoint || !endPoint) return part.coordinates;

    const coordinates: [number, number][] = [];

    if (startPoint.segmentIndex === endPoint.segmentIndex) {
      // Both on same segment
      coordinates.push(startPoint.projectedPoint);
      coordinates.push(endPoint.projectedPoint);
    } else if (startPoint.segmentIndex < endPoint.segmentIndex) {
      // Start before end
      coordinates.push(startPoint.projectedPoint);
      for (let i = startPoint.segmentIndex + 1; i <= endPoint.segmentIndex; i++) {
        coordinates.push(part.coordinates[i]);
      }
      coordinates.push(endPoint.projectedPoint);
    } else {
      // End before start - reverse
      coordinates.push(startPoint.projectedPoint);
      for (let i = startPoint.segmentIndex; i > endPoint.segmentIndex; i--) {
        coordinates.push(part.coordinates[i]);
      }
      coordinates.push(endPoint.projectedPoint);
    }

    return coordinates;
  }

  /**
   * Build coordinates for first part (truncated from start coordinate to connection)
   */
  private buildFirstPartCoordinates(
    partId: string,
    nextPartId: string,
    startCoordinate: [number, number]
  ): [number, number][] {
    const part = this.parts.get(partId);
    const nextPart = this.parts.get(nextPartId);
    if (!part || !nextPart) return part ? part.coordinates : [];

    // Determine which endpoint connects to next part
    const endKey = this.coordinateToKey(part.endPoint);
    const nextStartKey = this.coordinateToKey(nextPart.startPoint);
    const nextEndKey = this.coordinateToKey(nextPart.endPoint);
    const endsConnect = (endKey === nextStartKey || endKey === nextEndKey);

    const startPoint = this.findNearestPointOnPart(partId, startCoordinate);
    if (!startPoint) return part.coordinates;

    const truncated: [number, number][] = [];
    truncated.push(startPoint.projectedPoint);

    if (endsConnect) {
      // Go from start point to end of part
      for (let j = startPoint.segmentIndex + 1; j < part.coordinates.length - 1; j++) {
        truncated.push(part.coordinates[j]);
      }
      // CRITICAL: Always end with exact endpoint for chain continuity
      truncated.push(part.endPoint);
    } else {
      // Go from start point to start of part (reverse)
      for (let j = startPoint.segmentIndex; j >= 1; j--) {
        truncated.push(part.coordinates[j]);
      }
      // CRITICAL: Always end with exact endpoint for chain continuity
      truncated.push(part.startPoint);
    }

    return truncated;
  }

  /**
   * Build coordinates for last part (truncated from connection to end coordinate)
   */
  private buildLastPartCoordinates(
    partId: string,
    prevPartId: string,
    endCoordinate: [number, number]
  ): [number, number][] {
    const part = this.parts.get(partId);
    const prevPart = this.parts.get(prevPartId);
    if (!part || !prevPart) return part ? part.coordinates : [];

    // Determine which endpoint connects to previous part
    const startKey = this.coordinateToKey(part.startPoint);
    const prevStartKey = this.coordinateToKey(prevPart.startPoint);
    const prevEndKey = this.coordinateToKey(prevPart.endPoint);
    const startsConnect = (startKey === prevStartKey || startKey === prevEndKey);

    const endPoint = this.findNearestPointOnPart(partId, endCoordinate);
    if (!endPoint) return part.coordinates;

    const truncated: [number, number][] = [];

    if (startsConnect) {
      // Go from start of part to end point
      // CRITICAL: Always start with exact endpoint for chain continuity
      truncated.push(part.startPoint);
      for (let j = 1; j <= endPoint.segmentIndex; j++) {
        truncated.push(part.coordinates[j]);
      }
    } else {
      // Go from end of part to end point (reverse)
      // CRITICAL: Always start with exact endpoint for chain continuity
      truncated.push(part.endPoint);
      for (let j = part.coordinates.length - 2; j > endPoint.segmentIndex; j--) {
        truncated.push(part.coordinates[j]);
      }
    }

    truncated.push(endPoint.projectedPoint);
    return truncated;
  }

  // ============================================================================
  // PATH RESULT BUILDING
  // ============================================================================

  /**
   * Build PathResult from part IDs (merges and orients coordinates)
   */
  private buildPathResult(partIds: string[]): PathResult {
    const coordinateSublists: [number, number][][] = [];

    for (const partId of partIds) {
      const part = this.parts.get(partId);
      if (part) {
        coordinateSublists.push(part.coordinates);
      }
    }

    const coordinates = this.mergeLinearChain(coordinateSublists);

    return { partIds, coordinates };
  }

  /**
   * Merge coordinate sublists into a single linear chain
   * Ensures proper orientation and removes duplicate connection points
   */
  private mergeLinearChain(sublists: [number, number][][]): [number, number][] {
    if (sublists.length === 0) return [];
    if (sublists.length === 1) return sublists[0];

    const remainingSublists = sublists.map(s => [...s]);

    // Find starting sublist (prefer one with endpoint appearing only once)
    const coordCount = this.countEndpointFrequencies(remainingSublists);
    let startingIndex = this.findStartingSublistIndex(remainingSublists, coordCount);

    if (startingIndex === -1) {
      console.log('[RailwayPathFinder] No clear endpoint found, using first sublist');
      startingIndex = 0;
    }

    // Extract and orient starting sublist
    const mergedChain = [...remainingSublists[startingIndex]];
    remainingSublists.splice(startingIndex, 1);

    this.orientStartingSublist(mergedChain, coordCount);

    // Build chain incrementally
    while (remainingSublists.length > 0) {
      const lastCoord = mergedChain[mergedChain.length - 1];

      const lastCoordKey = this.coordinateToKey(lastCoord);
      const nextIndex = remainingSublists.findIndex(sublist =>
        sublist.some(coord => this.coordinateToKey(coord) === lastCoordKey)
      );

      if (nextIndex === -1) {
        throw new Error("Chain is broken; no connecting sublist found.");
      }

      const nextSublist = [...remainingSublists[nextIndex]];
      const overlapIndex = nextSublist.findIndex(
        coord => this.coordinateToKey(coord) === lastCoordKey
      );

      if (overlapIndex !== 0) {
        nextSublist.reverse();
      }

      mergedChain.push(...nextSublist.slice(1));
      remainingSublists.splice(nextIndex, 1);
    }

    return mergedChain;
  }

  /**
   * Count how many times each endpoint coordinate appears
   */
  private countEndpointFrequencies(
    sublists: [number, number][][]
  ): Map<string, number> {
    const coordCount = new Map<string, number>();

    sublists.forEach(sublist => {
      const firstKey = `${sublist[0][0]},${sublist[0][1]}`;
      const lastKey = `${sublist[sublist.length - 1][0]},${sublist[sublist.length - 1][1]}`;
      coordCount.set(firstKey, (coordCount.get(firstKey) || 0) + 1);
      coordCount.set(lastKey, (coordCount.get(lastKey) || 0) + 1);
    });

    return coordCount;
  }

  /**
   * Find index of sublist that should start the chain
   */
  private findStartingSublistIndex(
    sublists: [number, number][][],
    coordCount: Map<string, number>
  ): number {
    return sublists.findIndex(sublist => {
      const firstCoord = `${sublist[0][0]},${sublist[0][1]}`;
      const lastCoord = `${sublist[sublist.length - 1][0]},${sublist[sublist.length - 1][1]}`;
      return coordCount.get(firstCoord) === 1 || coordCount.get(lastCoord) === 1;
    });
  }

  /**
   * Orient starting sublist so endpoint (count=1) is at the end
   */
  private orientStartingSublist(
    mergedChain: [number, number][],
    coordCount: Map<string, number>
  ): void {
    const firstCoord = `${mergedChain[0][0]},${mergedChain[0][1]}`;
    const lastCoord = `${mergedChain[mergedChain.length - 1][0]},${mergedChain[mergedChain.length - 1][1]}`;

    // If last coord appears only once and first doesn't, reverse
    if (coordCount.get(lastCoord) === 1 && coordCount.get(firstCoord) !== 1) {
      mergedChain.reverse();
    }
  }

  // ============================================================================
  // GEOMETRY UTILITIES
  // ============================================================================

  /**
   * Project a point onto a line segment and return projection point + distance
   */
  private projectPointOnSegment(
    point: [number, number],
    segmentStart: [number, number],
    segmentEnd: [number, number]
  ): PointOnSegment {
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

    return {
      projectedPoint: [xx, yy],
      distance: this.haversineDistance(point, [xx, yy])
    };
  }

  /**
   * Calculate distance from point to line segment
   */
  private pointToSegmentDistance(
    point: [number, number],
    segmentStart: [number, number],
    segmentEnd: [number, number]
  ): number {
    return this.projectPointOnSegment(point, segmentStart, segmentEnd).distance;
  }

  /**
   * Calculate geographic distance using Haversine formula
   */
  private haversineDistance(
    coord1: [number, number],
    coord2: [number, number]
  ): number {
    const R = 6371000; // Earth's radius in meters
    const lat1 = coord1[1] * Math.PI / 180;
    const lat2 = coord2[1] * Math.PI / 180;
    const deltaLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const deltaLon = (coord2[0] - coord1[0]) * Math.PI / 180;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Calculate total distance for a path (by part IDs)
   */
  private calculatePathDistance(partIds: string[]): number {
    let totalDistance = 0;

    for (const partId of partIds) {
      const part = this.parts.get(partId);
      if (!part) continue;

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
   * Calculate total distance for a coordinate chain
   */
  private calculateCoordinateDistance(coordinates: [number, number][]): number {
    let distance = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
      distance += this.haversineDistance(coordinates[i], coordinates[i + 1]);
    }
    return distance;
  }

  // ============================================================================
  // GRAPH CONNECTIVITY
  // ============================================================================

  /**
   * Get all part IDs connected to a given part (sorted deterministically)
   */
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

  // ============================================================================
  // DATABASE HELPERS
  // ============================================================================

  /**
   * Get a database client from Pool or Client
   */
  private async getClient(dbClient: Client | Pool): Promise<Client | PoolClient> {
    if ('totalCount' in dbClient) {
      return await (dbClient as Pool).connect();
    }
    return dbClient as Client;
  }

  /**
   * Release client if it was obtained from a Pool
   */
  private releaseClient(
    original: Client | Pool,
    client: Client | PoolClient
  ): void {
    if ('totalCount' in original && 'release' in client) {
      client.release();
    }
  }

  /**
   * Parse database rows and store parts in memory
   */
  private parseAndStoreParts(rows: any[]): void {
    for (const row of rows) {
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

        // Add to coordinate mapping for connection lookups
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
  }

  /**
   * Convert coordinate to string key (rounded to 7 decimal places)
   */
  private coordinateToKey(coord: [number, number]): string {
    return `${coord[0].toFixed(7)},${coord[1].toFixed(7)}`;
  }
}
