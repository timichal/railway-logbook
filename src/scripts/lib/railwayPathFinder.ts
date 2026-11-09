import type { Client, Pool } from "pg";
import { BACKTRACKING_THRESHOLD_DEGREES } from "../../lib/geoUtils";
import type { BacktrackingPoint, PathResult } from "../../lib/shared/types";
import { MinHeap } from "./minHeap";
import {
  buildCoordinatesWithTruncation,
  coordinateDistance,
  distancesToEnds,
  findBacktracking,
  pathDistance,
  turnDegrees,
} from "./partGeometry";
import { PartNetwork, type RailwayPart } from "./partNetwork";
import { loadPartRoutesAround, type PartRoutes } from "./partRoutes";

/** A path as parts only; its coordinates are built by the caller, truncated to the clicks. */
type PartPath = Omit<PathResult, "coordinates">;

/** The click points on a path's start and end parts, [lng, lat]. */
interface EdgeClicks {
  start: [number, number];
  end: [number, number];
}

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
  /**
   * Between click points matched to several parts, prefer a combination whose path
   * doesn't backtrack over a shorter one that does, within `backtrackingSlack`.
   * (Within one combination a path that doesn't backtrack is always preferred, see
   * `findPath`; this is the choice between combinations.) Without it a straight path
   * wins only when it is within 10m. For scenic lines, which may not backtrack at
   * all. Routes keep the default: a route may backtrack where nothing else connects
   * its click points, and between combinations the shorter one wins.
   */
  avoidBacktracking?: boolean;
  /**
   * Keep off track other routes already run along: such a part costs
   * `TAKEN_PART_WEIGHT` times its length, so a route keeps to track of its own
   * unless the only free way is much longer. For routes only; a scenic line is
   * meant to lie on routes.
   *
   * `trackId` is the route being re-picked or recalculated (null for a new one):
   * no part it runs along now counts, whoever else runs along it too. `snapshot` is every part's routes taken
   * once before a bulk run (`loadAllPartRoutes`), so every route is judged
   * against the same state of the others, whatever order the run takes them in.
   * Without one the finder loads them for the area it searches, as they now
   * stand (`loadPartRoutesAround`).
   */
  avoidOtherRoutes?: { trackId: number | null; snapshot?: PartRoutes };
}

/**
 * The cost of a part another route runs along, per metre, against 1 for a free
 * one. A shared stretch wins only where the free way round is over 50% longer.
 * The shortcuts that made it needed were +23% (Ulikowo–Piła), +41% (Szczecin) and
 * a parallel line's track (Fukushima–Tsukinoki).
 */
const TAKEN_PART_WEIGHT = 1.5;

/**
 * How much longer than a backtracking path a non-backtracking one of another
 * click-point combination may be and still be preferred: 10% or 5km, whichever is smaller (the percentage rules on long
 * paths, the +5km on short ones). In metres, as `distance` is.
 */
function backtrackingSlack(distance: number): number {
  return Math.min(distance * 1.1, distance + 5000);
}

/**
 * RailwayPathFinder: shortest-path search over railway parts
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
  private readonly avoidBacktracking: boolean;
  private readonly avoidOtherRoutes: PathFinderOptions["avoidOtherRoutes"];
  /** The routes of the parts loaded, for `avoidOtherRoutes`. */
  private partRoutes: PartRoutes | null = null;

  constructor(options: PathFinderOptions = {}) {
    this.quiet = options.quiet ?? false;
    this.avoidBacktracking = options.avoidBacktracking ?? false;
    this.avoidOtherRoutes = options.avoidOtherRoutes;
    this.partRoutes = options.avoidOtherRoutes?.snapshot ?? null;
  }

  /**
   * Whether a part is another route's: another route runs along it and the one
   * being searched for doesn't. Track a route already shares is not held against
   * it, so a duplicate being split (both copies on the whole stretch until each is
   * re-picked) and two routes that share a stretch on purpose keep to it.
   */
  private isTaken(partId: string): boolean {
    const routes = this.partRoutes?.get(partId);
    if (!routes) return false;
    const own = this.avoidOtherRoutes?.trackId ?? null;
    return own === null || !routes.includes(own);
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
   * 1. Find the shortest path by length
   * 2. Check if it backtracks
   * 3. If it does, find the shortest path that doesn't
   *
   * Returns the candidates in order of preference, empty if there is no path: the
   * alternative, then the backtracking path to fall back on. Which one is used is
   * the caller's call, since only the geometry it builds says whether a path connects.
   *
   * `clicks` are the points on the start and end parts the path is cut to; given,
   * the search charges those two parts only for the stretch travelled (see
   * `findShortestPath`).
   */
  findPath(startId: string, endId: string, clicks?: EdgeClicks): PartPath[] {
    if (!this.network.has(startId) || !this.network.has(endId)) {
      return [];
    }

    if (startId === endId) {
      return [{ partIds: [startId], hasBacktracking: false }];
    }

    // Step 1: the shortest path, reversals and all
    const firstPath = this.findShortestPath(startId, endId, false, clicks);
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

    // Step 3: the shortest path that doesn't reverse, however much longer. A
    // reversal is nearly always a shortcut through a junction that no train takes
    // — the real line was 5% longer on Olsztyn–Ełk, 16% on Urakami–Kikitsu — so
    // the only reason to keep one is that nothing else connects.
    this.log(`  Searching for a path without backtracking...`);
    const alternative = this.findShortestPath(startId, endId, true, clicks);
    // The search judges each turn as it goes, `findBacktracking` the finished
    // path; and it may pass a part twice, once each way, round a loop. Either
    // way it is not a path to prefer.
    if (
      !alternative ||
      new Set(alternative).size !== alternative.length ||
      this.locateBacktracking(this.partsOf(alternative))
    ) {
      this.log(`  No path without backtracking, using the shortest`);
      return [backtrackingPath];
    }

    // Measured only to be logged, so not in a quiet (bulk) run
    if (!this.quiet) {
      this.log(
        `  Preferring a path without backtracking (${(pathDistance(this.partsOf(alternative)) / 1000).toFixed(1)}km) over the shortest (${(pathDistance(firstParts) / 1000).toFixed(1)}km)`,
      );
    }
    return [{ partIds: alternative, hasBacktracking: false }, backtrackingPath];
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

      // Which routes run along the parts just loaded, unless a bulk run handed
      // its snapshot. After the check above, so a click off the network, the
      // commonest way a route breaks, doesn't pay for it.
      if (this.avoidOtherRoutes && !this.avoidOtherRoutes.snapshot) {
        this.partRoutes = await loadPartRoutesAround(
          dbClient,
          [startCoordinate, endCoordinate],
          bufferMeters,
        );
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
    // The shortest combination that doesn't backtrack, for `avoidBacktracking`
    let straightResult: PathResult | null = null;
    let straightDistance = Infinity;

    for (const startPartId of startPartIds) {
      for (const endPartId of endPartIds) {
        this.log(`  Trying path: ${startPartId} → ${endPartId}`);

        const candidates = this.findPath(startPartId, endPartId, {
          start: startCoordinate,
          end: endCoordinate,
        });
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

        // What the path costs, as the search costs it: its length, plus the
        // surcharge for track other routes run along. Combinations are compared
        // on this, not on length alone, or a click on a junction would undo the
        // search's keeping off other routes: the combination that starts on the
        // taken track would win on length. Without `avoidOtherRoutes` it is the length.
        const length = coordinateDistance(coordinates);
        const distance =
          length +
          this.takenSurcharge(this.partsOf(pathResult.partIds), startCoordinate, endCoordinate);
        this.log(`    Distance: ${(length / 1000).toFixed(2)} km`);

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

        const result: PathResult = {
          partIds: pathResult.partIds,
          coordinates,
          hasBacktracking: pathResult.hasBacktracking,
          backtrackingAt: pathResult.backtrackingAt,
        };
        if (shouldUpdate) {
          bestDistance = distance;
          bestResult = result;
        }
        if (!pathResult.hasBacktracking && distance < straightDistance) {
          straightDistance = distance;
          straightResult = result;
        }
      }
    }

    if (
      this.avoidBacktracking &&
      bestResult?.hasBacktracking &&
      straightResult &&
      straightDistance <= backtrackingSlack(bestDistance)
    ) {
      this.log(
        `Selected non-backtracking path: ${(straightDistance / 1000).toFixed(2)} km (shortest backtracks)`,
      );
      return straightResult;
    }

    if (bestResult) {
      this.log(`Selected shortest path: ${(bestDistance / 1000).toFixed(2)} km`);
    }

    return bestResult;
  }

  // ============================================================================
  // SEARCH
  // ============================================================================

  /**
   * The shortest path by length from one part to another, as part ids, or null if
   * none joins them. Dijkstra, every part costing its whole length.
   *
   * Except, given `clicks`, the two the path is cut to: the start part costs the
   * stretch from its click to the end it is left through, the end part the stretch
   * from the end it is entered at to its click. A click near one end of a long
   * part otherwise costs the same both ways, and the search left Dęblin through the
   * far end of a 509m part whose click sat 5m from the near one. Without `clicks`
   * the start part costs nothing and the end part its whole length. A part another
   * route runs along (`avoidOtherRoutes`) costs `TAKEN_PART_WEIGHT` times as much.
   *
   * `withoutBacktracking` searches only paths that never turn back on themselves:
   * a part is left through the end it was not entered at, and the turn onto the
   * next is at most `BACKTRACKING_THRESHOLD_DEGREES`. The state is then the part
   * **and the end it was entered at**, since whether it can be left onto a given
   * neighbour depends on which way it is travelled, and a short arrival from one
   * side must not shut out a longer one from the other that can carry on. The
   * start part, entered at neither end, may be left through either.
   *
   * This replaced a breadth-first search by part count, which preferred a long way
   * round of few ways over a short line of many, and took the lower part id
   * between two of equal count.
   */
  private findShortestPath(
    startId: string,
    endId: string,
    withoutBacktracking: boolean,
    clicks?: EdgeClicks,
  ): string[] | null {
    const startPart = this.network.get(startId);
    const endPart = this.network.get(endId);
    const startStretch = clicks && startPart ? distancesToEnds(startPart, clicks.start) : null;
    // Per metre, `TAKEN_PART_WEIGHT` for a part another route runs along
    const weightOf = (partId: string) => (this.isTaken(partId) ? TAKEN_PART_WEIGHT : 1);
    const endStretch = clicks && endPart ? distancesToEnds(endPart, clicks.end) : null;

    // A state's key is the part id, or for `withoutBacktracking` the part id and
    // the endpoint key it was entered at ("" for the start part).
    const stateKey = (partId: string, entryKey: string) =>
      withoutBacktracking ? `${partId}|${entryKey}` : partId;

    const startKey = stateKey(startId, "");
    const distance = new Map<string, number>([[startKey, 0]]);
    const parent = new Map<string, string>();
    const partOf = new Map<string, string>([[startKey, startId]]);
    const entryOf = new Map<string, string>([[startKey, ""]]);
    const queue = new MinHeap<string>();
    queue.push(startKey, 0);

    let endState: string | null = null;
    for (let popped = queue.pop(); popped; popped = queue.pop()) {
      const { item: key, priority: currentDistance } = popped;
      if (currentDistance > distance.get(key)!) continue; // A stale entry
      const partId = partOf.get(key)!;
      if (partId === endId) {
        endState = key;
        break;
      }

      const part = this.network.get(partId);
      if (!part) continue;
      const entryKey = entryOf.get(key)!;
      // The nodes the part may be left through: the far end from where it was
      // entered, either end for the start part (or with reversals allowed)
      const exitKeys =
        !withoutBacktracking || entryKey === ""
          ? [part.startKey, part.endKey]
          : [entryKey === part.startKey ? part.endKey : part.startKey];

      for (const nextId of this.network.connected(partId)) {
        const next = this.network.get(nextId);
        if (!next) continue;

        // Every node the two share among those the part may be left through: two
        // parts can share both ends (a loop track between the same two switches),
        // and each node is its own way onto the next, at its own cost
        for (const nodeKey of exitKeys) {
          if (nodeKey !== next.startKey && nodeKey !== next.endKey) continue;
          if (
            withoutBacktracking &&
            turnDegrees(part, nodeKey, next) > BACKTRACKING_THRESHOLD_DEGREES
          ) {
            continue;
          }

          // What leaving the start part through this node costs, and what entering
          // the next part through it does (see above)
          const leaving =
            key === startKey && startStretch
              ? nodeKey === part.startKey
                ? startStretch.toStart
                : startStretch.toEnd
              : 0;
          const entering =
            nextId === endId && endStretch
              ? nodeKey === next.startKey
                ? endStretch.toStart
                : endStretch.toEnd
              : next.lengthMeters;

          const nextKey = stateKey(nextId, nodeKey);
          const nextDistance =
            currentDistance + leaving * weightOf(partId) + entering * weightOf(nextId);
          const known = distance.get(nextKey);
          if (known !== undefined && known <= nextDistance) continue;

          distance.set(nextKey, nextDistance);
          parent.set(nextKey, key);
          partOf.set(nextKey, nextId);
          entryOf.set(nextKey, nodeKey);
          queue.push(nextKey, nextDistance);
        }
      }
    }

    if (endState === null) return null;

    const path: string[] = [];
    for (let key: string | undefined = endState; key !== undefined; key = parent.get(key)) {
      path.push(partOf.get(key)!);
    }
    return path.reverse();
  }

  /**
   * What keeping off other routes adds to a path's cost (`TAKEN_PART_WEIGHT`), in
   * metres: the stretch travelled on taken parts, the end parts from and to their
   * clicks, times the weight's excess over 1. As `findShortestPath` charges it.
   */
  private takenSurcharge(
    parts: RailwayPart[],
    startCoordinate: [number, number],
    endCoordinate: [number, number],
  ): number {
    if (!this.partRoutes) return 0;
    let taken = 0;
    parts.forEach((part, i) => {
      if (!this.isTaken(part.id)) return;
      if (parts.length === 1) {
        const from = distancesToEnds(part, startCoordinate);
        const to = distancesToEnds(part, endCoordinate);
        taken += from && to ? Math.abs(from.toStart - to.toStart) : part.lengthMeters;
      } else if (i === 0 || i === parts.length - 1) {
        // The stretch between the click and the end that meets the rest of the path
        const neighbour = parts[i === 0 ? 1 : i - 1];
        const meetsAtEnd = part.endKey === neighbour.startKey || part.endKey === neighbour.endKey;
        const stretch = distancesToEnds(part, i === 0 ? startCoordinate : endCoordinate);
        taken += stretch ? (meetsAtEnd ? stretch.toEnd : stretch.toStart) : part.lengthMeters;
      } else {
        taken += part.lengthMeters;
      }
    });
    return taken * (TAKEN_PART_WEIGHT - 1);
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
