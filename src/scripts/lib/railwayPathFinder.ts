import type { Client, Pool } from "pg";
import { BACKTRACKING_THRESHOLD_DEGREES } from "../../lib/geoUtils";
import type { BacktrackingPoint, PathResult } from "../../lib/shared/types";
import {
  buildCoordinatesWithTruncation,
  coordinateDistance,
  findBacktracking,
  isTraversedForward,
  pathDistance,
  wouldCreateBacktracking,
} from "./partGeometry";
import { PartNetwork, type RailwayPart } from "./partNetwork";

export type { BacktrackingPoint, PathResult };

/** A path as parts only; its coordinates are built by the caller, truncated to the clicks. */
type PartPath = Omit<PathResult, "coordinates">;

export interface PathFinderOptions {
  /**
   * Silence the search's progress logging.
   *
   * A bulk recalculation runs thousands of searches, several of them at once,
   * and their per-route chatter is noise. This used to be done by swapping out
   * the global `console.log` around each call, which only worked while calls
   * were strictly serial: with two in flight, the first to finish un-silences
   * the rest, and one that starts while the patch is in place captures the
   * no-op as its "original" and silences logging permanently.
   */
  quiet?: boolean;
}

/**
 * RailwayPathFinder: BFS-based pathfinding for railway networks
 *
 * Features:
 * - Part-based pathfinding (between railway part IDs)
 * - Coordinate-based pathfinding (between GPS coordinates)
 * - Backtracking detection and avoidance
 * - Progressive buffer retry (50km → 100km → 222km) while both click points are on
 *   the network but no path joins them; a point off the network fails at once
 * - Edge truncation for coordinate-based routes
 *
 * The parts it searches are a `PartNetwork`, and the geometry over them —
 * orientation, backtracking, truncation — is `partGeometry.ts`.
 */
export class RailwayPathFinder {
  private readonly network = new PartNetwork();
  private readonly quiet: boolean;

  constructor(options: PathFinderOptions = {}) {
    this.quiet = options.quiet ?? false;
  }

  /** Progress logging, dropped entirely when the finder is quiet. */
  private log(message: string): void {
    if (!this.quiet) console.log(message);
  }

  /**
   * The loaded parts for a path's ids. Every id a search returns is loaded, so a
   * missing one is a bug — and skipping it would shift every later part into its
   * neighbour's position, orienting and truncating against the wrong part.
   */
  private partsOf(partIds: string[]): RailwayPart[] {
    return partIds.map((partId) => {
      const part = this.network.get(partId);
      if (!part) throw new Error(`Part ${partId} is on a path but not loaded`);
      return part;
    });
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
   *
   * Returns the candidates in order of preference, empty if there is no path: the
   * alternative, then the backtracking path to fall back on. Which one is used is
   * the caller's call, since only the geometry it builds says whether a path connects.
   */
  findPath(startId: string, endId: string): PartPath[] {
    if (!this.network.has(startId) || !this.network.has(endId)) {
      return [];
    }

    if (startId === endId) {
      return [{ partIds: [startId], hasBacktracking: false }];
    }

    // Step 1: Find shortest path using standard BFS
    const firstPath = this.findShortestPath(startId, endId);
    if (!firstPath) {
      return [];
    }

    // Step 2: Check if it backtracks
    const firstParts = this.partsOf(firstPath);
    const firstBacktracking = this.locateBacktracking(firstParts);
    if (!firstBacktracking) {
      return [{ partIds: firstPath, hasBacktracking: false }];
    }
    const backtrackingPath: PartPath = {
      partIds: firstPath,
      hasBacktracking: true,
      backtrackingAt: firstBacktracking,
    };

    // Step 3: Search for non-backtracking alternative. Non-backtracking paths are often
    // slightly longer, so allow some slack: 10% or 5km, whichever is smaller (the
    // percentage rules on long paths, the +5km on short ones). The search returns
    // nothing longer than this, so whatever it finds is acceptable.
    const firstDistance = pathDistance(firstParts);
    const maxDistance = Math.min(firstDistance * 1.1, firstDistance + 5000);
    this.log(
      `  Searching for non-backtracking alternatives (max ${(maxDistance / 1000).toFixed(1)}km)...`,
    );

    const bestAlternative = this.findNonBacktrackingAlternative(startId, endId, maxDistance);

    if (!bestAlternative) {
      this.log(`  No non-backtracking alternative found, using original`);
      return [backtrackingPath];
    }

    const altDistance = pathDistance(this.partsOf(bestAlternative));
    this.log(
      `  Preferring non-backtracking alternative (${(altDistance / 1000).toFixed(1)}km) over backtracking path (${(firstDistance / 1000).toFixed(1)}km)`,
    );
    return [{ partIds: bestAlternative, hasBacktracking: false }, backtrackingPath];
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
    endCoordinate: [number, number],
  ): Promise<PathResult | null> {
    const buffers = [50000, 100000, 222000]; // 50km, 100km, 222km

    // The parts containing each click point are the same at every buffer: such
    // a part lies within 1m of the point, so the smallest buffer already loads
    // it if it exists at all, and a larger one only adds parts farther away. The
    // order is the same too, since every load is `ORDER BY id`. So they are
    // found once, on the first pass — and a point off the network fails the
    // route there, instead of paying for the two largest loads to find the same
    // nothing. That is the commonest way a route breaks after an OSM update.
    // (The buffer ladder itself is untouched; see RECALC_PERFORMANCE.md on why
    // it must not shrink.)
    let startPartIds: string[] | null = null;
    let endPartIds: string[] | null = null;

    for (const bufferMeters of buffers) {
      this.log(`Attempting coordinate-based pathfinding with ${bufferMeters / 1000}km buffer...`);
      this.network.clear();

      // Load parts around both coordinates, in one query (see `loadAround`)
      await this.network.loadAround(dbClient, [startCoordinate, endCoordinate], bufferMeters);

      if (!startPartIds || !endPartIds) {
        // Find parts containing the coordinates (1m tolerance)
        startPartIds = this.network.partsContaining(startCoordinate, 1);
        endPartIds = this.network.partsContaining(endCoordinate, 1);

        if (startPartIds.length === 0) {
          this.log(`Start coordinate not found on any part (buffer: ${bufferMeters / 1000}km)`);
          return null;
        }

        if (endPartIds.length === 0) {
          this.log(`End coordinate not found on any part (buffer: ${bufferMeters / 1000}km)`);
          return null;
        }

        this.log(`Found ${startPartIds.length} start part(s): ${startPartIds.join(", ")}`);
        this.log(`Found ${endPartIds.length} end part(s): ${endPartIds.join(", ")}`);
      }

      // Try all combinations
      const bestResult = this.findBestCoordinatePath(
        startPartIds,
        endPartIds,
        startCoordinate,
        endCoordinate,
      );

      if (bestResult) {
        return bestResult;
      }

      this.log(`No valid path found (buffer: ${bufferMeters / 1000}km)`);
    }

    this.log("No path found with any buffer size");
    return null;
  }

  /**
   * Find best path among all start/end part combinations for coordinate-based routing
   */
  private findBestCoordinatePath(
    startPartIds: string[],
    endPartIds: string[],
    startCoordinate: [number, number],
    endCoordinate: [number, number],
  ): PathResult | null {
    let bestResult: PathResult | null = null;
    let bestDistance = Infinity;

    for (const startPartId of startPartIds) {
      for (const endPartId of endPartIds) {
        this.log(`  Trying path: ${startPartId} → ${endPartId}`);

        const candidates = this.findPath(startPartId, endPartId);
        if (candidates.length === 0) {
          this.log(`    No path found`);
          continue;
        }

        // Build coordinates with edge truncation, taking the first candidate whose
        // chain connects (a non-backtracking alternative that doesn't falls back to
        // the backtracking path)
        let pathResult: PartPath | null = null;
        let coordinates: [number, number][] = [];
        for (const candidate of candidates) {
          // Outside the try: a part missing from the network is a bug, not a broken chain
          const candidateParts = this.partsOf(candidate.partIds);
          try {
            coordinates = buildCoordinatesWithTruncation(
              candidateParts,
              startCoordinate,
              endCoordinate,
            );
            pathResult = candidate;
            break;
          } catch {
            this.log(`    ⚠️  Chain broken for a ${candidate.partIds.length}-part candidate`);
          }
        }
        if (!pathResult) {
          this.log(`    ❌ Chain broken - skipping this combination`);
          continue;
        }

        this.log(`    Path found with ${pathResult.partIds.length} parts`);

        // Calculate total distance
        const distance = coordinateDistance(coordinates);
        this.log(`    Distance: ${(distance / 1000).toFixed(2)} km`);

        // Selection logic: prefer non-backtracking paths when distances are close
        const isSameDistance = Math.abs(distance - bestDistance) < 10; // 10 meters tolerance
        const replacingGoodWithBad =
          bestResult && !bestResult.hasBacktracking && pathResult.hasBacktracking;
        const betterQuality = bestResult?.hasBacktracking && !pathResult.hasBacktracking;

        // Update if:
        // 1. No best result yet, OR
        // 2. Shorter distance (but not if replacing non-backtracking with backtracking when close), OR
        // 3. Same distance and better quality (non-backtracking over backtracking)
        const shouldUpdate =
          !bestResult ||
          (distance < bestDistance && !(isSameDistance && replacingGoodWithBad)) ||
          (isSameDistance && betterQuality);

        if (shouldUpdate) {
          bestDistance = distance;
          bestResult = {
            partIds: pathResult.partIds,
            coordinates,
            hasBacktracking: pathResult.hasBacktracking,
            backtrackingAt: pathResult.backtrackingAt,
          };
        }
      }
    }

    if (bestResult) {
      this.log(`Selected shortest path: ${(bestDistance / 1000).toFixed(2)} km`);
    }

    return bestResult;
  }

  // ============================================================================
  // BFS SEARCH ALGORITHMS
  // ============================================================================

  /**
   * Find shortest path using standard BFS with global visited set
   */
  private findShortestPath(startId: string, endId: string): string[] | null {
    // A head index rather than `shift()`, which reindexes the whole queue on
    // every pop. The pop order is unchanged, so the search is the same search.
    // Consumed slots are cleared so their paths can be collected — at the 222km
    // buffer the queue holds tens of thousands of entries.
    const queue: ({ id: string; path: string[] } | undefined)[] = [
      { id: startId, path: [startId] },
    ];
    let head = 0;
    const visited = new Set<string>([startId]);

    while (head < queue.length) {
      const current = queue[head]!;
      queue[head] = undefined;
      head++;
      const connected = this.network.connected(current.id);

      for (const connectedId of connected) {
        if (connectedId === endId) {
          return [...current.path, connectedId];
        }

        if (!visited.has(connectedId)) {
          visited.add(connectedId);
          queue.push({
            id: connectedId,
            path: [...current.path, connectedId],
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
   * The distance is kept per part **and the end it was entered at**, not per part:
   * whether a part can be left without backtracking depends on which way it is being
   * travelled, so a short arrival from one side must not prune a longer one from the
   * other — that may be the only one that can carry on.
   */
  private findPathWithoutBacktracking(
    startId: string,
    endId: string,
    maxDistance: number,
    forcedFirstHop?: string,
  ): string[] | null {
    // Head index rather than `shift()`, as in `findShortestPath`.
    const queue: ({ id: string; key: string; path: string[]; distance: number } | undefined)[] = [
      {
        id: startId,
        key: startId,
        path: [startId],
        distance: 0,
      },
    ];
    let head = 0;

    const bestDistance = new Map<string, number>();
    bestDistance.set(startId, 0);

    let shortestPath: string[] | null = null;
    let shortestPathDistance = Infinity;

    while (head < queue.length) {
      const current = queue[head]!;
      queue[head] = undefined;
      head++;

      // Skip if we already found a better path to this node
      const currentBest = bestDistance.get(current.key);
      if (currentBest !== undefined && current.distance > currentBest) {
        continue;
      }

      // Prune if exceeding max distance
      if (current.distance > maxDistance) {
        continue;
      }

      const currentPart = this.network.get(current.id);
      if (!currentPart) continue;
      const prevId = current.path.length > 1 ? current.path[current.path.length - 2] : null;
      const prevPart = prevId === null ? null : (this.network.get(prevId) ?? null);

      const connected = this.network.connected(current.id);

      for (const connectedId of connected) {
        // Enforce forced first hop if specified
        if (current.id === startId && forcedFirstHop && connectedId !== forcedFirstHop) {
          continue;
        }

        // Prevent cycles in current path
        if (current.path.includes(connectedId)) {
          continue;
        }

        const connectedPart = this.network.get(connectedId);
        if (!connectedPart) continue;

        // Reject if adding this node creates backtracking. On the part that
        // completes the path this is not redundant with the whole-path check
        // below: `findBacktracking` orients each part from the next one only, so
        // it cannot see a part entered and left through the same node.
        if (wouldCreateBacktracking(prevPart, currentPart, connectedPart)) {
          continue;
        }

        // Check if we reached the end
        if (connectedId === endId) {
          const completePath = [...current.path, connectedId];
          const completeParts = this.partsOf(completePath);
          if (this.locateBacktracking(completeParts)) continue;

          const completeDistance = pathDistance(completeParts);
          if (completeDistance <= maxDistance && completeDistance < shortestPathDistance) {
            shortestPath = completePath;
            shortestPathDistance = completeDistance;
          }
          continue;
        }

        // Calculate distance efficiently (only add new segment)
        const newDistance = current.distance + connectedPart.lengthMeters;

        // Only explore if this is best path to this node so far
        const key = `${connectedId}:${isTraversedForward(connectedPart, currentPart, null) ? "start" : "end"}`;
        const bestToNode = bestDistance.get(key);
        if (bestToNode === undefined || newDistance < bestToNode) {
          bestDistance.set(key, newDistance);
          queue.push({
            id: connectedId,
            key,
            path: [...current.path, connectedId],
            distance: newDistance,
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
    maxDistance: number,
  ): string[] | null {
    this.log(`  Trying to find path without backtracking...`);

    // First attempt: no forced first hop
    let path = this.findPathWithoutBacktracking(startId, endId, maxDistance);
    if (path) {
      const distance = pathDistance(this.partsOf(path));
      this.log(
        `  ✓ Found non-backtracking path via ${path[1]} (${path.length} parts, ${(distance / 1000).toFixed(1)}km)`,
      );
      return path;
    }

    // Retry with each possible first hop
    this.log(`  First attempt found no path, trying different starting branches...`);
    const firstHops = this.network.connected(startId);

    for (const firstHop of firstHops) {
      path = this.findPathWithoutBacktracking(startId, endId, maxDistance, firstHop);
      if (path) {
        const distance = pathDistance(this.partsOf(path));
        this.log(
          `  ✓ Found non-backtracking path via ${firstHop} on retry (${path.length} parts, ${(distance / 1000).toFixed(1)}km)`,
        );
        return path;
      }
    }

    this.log(`  No non-backtracking path found after ${firstHops.length + 1} attempts`);
    return null;
  }

  /** `findBacktracking`, logging what it finds. */
  private locateBacktracking(parts: RailwayPart[]): BacktrackingPoint | null {
    const found = findBacktracking(parts);
    if (found) {
      this.log(
        `    ⚠️  BACKTRACKING DETECTED at ${found.fromPartId}→${found.toPartId}: ${found.angleDegrees.toFixed(1)}° > ${BACKTRACKING_THRESHOLD_DEGREES}°`,
      );
    }
    return found;
  }
}
