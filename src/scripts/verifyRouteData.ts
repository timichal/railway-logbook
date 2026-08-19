import dotenv from "dotenv";
import { type Client, Pool } from "pg";
import { type Coord, coordinatesToWKT } from "../lib/coordinateUtils";
import { getDbConfig } from "../lib/dbConfig";
import {
  refreshAllStationProximity,
  STATION_ROUTE_PROXIMITY_METERS,
} from "../lib/stationProximity";
import { RailwayPathFinder } from "./lib/railwayPathFinder";

dotenv.config();

// Get database config after dotenv loads environment variables
const dbConfig = getDbConfig();

/**
 * How many routes are recalculated at once by default.
 *
 * Every route is recalculated independently of every other one, so this is the
 * one part of the import that parallelises for free. The ceiling is memory, not
 * Postgres: each worker holds its own bufferful of parsed part geometry, which
 * is why `importMapData` runs with a raised heap limit. Raise it by measuring,
 * not by guessing.
 */
export const DEFAULT_RECALC_CONCURRENCY = 4;

/** Read `--concurrency=N` off the command line, falling back to the default. */
export function parseConcurrencyArg(args: string[]): number {
  const flag = args.find((arg) => arg.startsWith("--concurrency="));
  if (!flag) return DEFAULT_RECALC_CONCURRENCY;

  const value = Number(flag.slice("--concurrency=".length));
  if (!Number.isInteger(value) || value < 1) {
    console.error(`Ignoring invalid ${flag} — using ${DEFAULT_RECALC_CONCURRENCY}`);
    return DEFAULT_RECALC_CONCURRENCY;
  }
  return value;
}

/** A pool sized for `concurrency` workers, plus headroom for their UPDATEs. */
export function createRecalcPool(concurrency: number): Pool {
  return new Pool({ ...dbConfig, max: concurrency + 2 });
}

export interface RecalculationResult {
  totalRoutes: number;
  successfulRoutes: number;
  invalidRoutes: number;
  backtrackingRoutes: Array<{ track_id: number; from_station: string; to_station: string }>;
  errors: Array<{ track_id: number; from_station: string; to_station: string; error: string }>;
}

/**
 * Recalculate a single railway route based on starting and ending coordinates
 */
export async function recalculateRoute(
  db: Client | Pool,
  startingCoordinate: [number, number],
  endingCoordinate: [number, number],
): Promise<{ success: boolean; coordinates?: Coord[]; error?: string; hasBacktracking?: boolean }> {
  // Quiet rather than silenced from outside: a bulk run makes thousands of these
  // searches, several at a time, and their progress logging would bury the
  // summary. See PathFinderOptions for why patching the global console.log —
  // which is what this used to do — cannot survive two overlapping searches.
  const pathFinder = new RailwayPathFinder({ quiet: true });

  try {
    const result = await pathFinder.findPathFromCoordinates(
      db,
      startingCoordinate,
      endingCoordinate,
    );

    if (!result) {
      return { success: false, error: "No path found between starting and ending coordinates" };
    }

    return {
      success: true,
      coordinates: result.coordinates,
      hasBacktracking: result.hasBacktracking || false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error during recalculation",
    };
  }
}

export interface RecalculationOptions {
  /** Skip routes already marked invalid (is_valid = FALSE); only recalculate valid ones. */
  validOnly?: boolean;
  /** Routes to recalculate at once. Defaults to DEFAULT_RECALC_CONCURRENCY. */
  concurrency?: number;
}

/** One route as read from the database, ready to recalculate. */
interface RouteRow {
  track_id: number;
  from_station: string;
  to_station: string;
  start_lng: string;
  start_lat: string;
  end_lng: string;
  end_lat: string;
  length_km: string | null;
  intended_backtracking: boolean;
}

/** What became of one route. Aggregated into RecalculationResult in track_id order. */
type RouteOutcome =
  | { status: "recalculated"; hasBacktracking: boolean }
  | { status: "invalid"; error: string };

/**
 * Recalculate one route and write the outcome.
 *
 * The UPDATE is autocommitted, one per route — deliberately not wrapped in a
 * transaction spanning the whole run, which would hold row locks on
 * `railway_routes` for the length of the import.
 */
async function recalculateAndStoreRoute(db: Pool, route: RouteRow): Promise<RouteOutcome> {
  const { track_id, start_lng, start_lat, end_lng, end_lat, length_km } = route;
  const originalLength = parseFloat(length_km ?? "");

  const startingCoordinate: [number, number] = [parseFloat(start_lng), parseFloat(start_lat)];
  const endingCoordinate: [number, number] = [parseFloat(end_lng), parseFloat(end_lat)];

  // Recalculate route from coordinates
  const recalcResult = await recalculateRoute(db, startingCoordinate, endingCoordinate);

  if (!recalcResult.success || !recalcResult.coordinates) {
    // Mark route as invalid
    await db.query(
      `
      UPDATE railway_routes
      SET
        is_valid = FALSE,
        error_message = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE track_id = $2
    `,
      [recalcResult.error, track_id],
    );

    return { status: "invalid", error: recalcResult.error || "Unknown error" };
  }

  // Convert coordinates to LineString WKT format
  const lineString = coordinatesToWKT(recalcResult.coordinates);

  // Calculate the new length
  const lengthQuery = await db.query(
    `
    SELECT ST_Length(ST_GeomFromText($1, 4326)::geography) / 1000 as new_length_km
  `,
    [lineString],
  );

  const newLength = parseFloat(lengthQuery.rows[0].new_length_km);
  const lengthDiff = Math.abs(newLength - originalLength);
  const lengthDiffPercent = (lengthDiff / originalLength) * 100;

  // A route with no usable stored length (NULL or 0) has nothing to compare
  // against — the percentage would be NaN/Infinity — so accept the
  // recalculated geometry, which also backfills the missing length.
  const comparable = Number.isFinite(originalLength) && originalLength > 0;

  // Check if the new length differs significantly from the original
  // Consider invalid if difference is more than 0.1 km AND more than 1%
  if (comparable && lengthDiff > 0.1 && lengthDiffPercent > 1) {
    const errorMsg = `Distance mismatch: original ${originalLength.toFixed(2)} km, recalculated ${newLength.toFixed(2)} km (diff: ${lengthDiff.toFixed(2)} km, ${lengthDiffPercent.toFixed(1)}%)`;

    // Mark route as invalid due to distance mismatch
    await db.query(
      `
      UPDATE railway_routes
      SET
        is_valid = FALSE,
        error_message = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE track_id = $2
    `,
      [errorMsg, track_id],
    );

    return { status: "invalid", error: errorMsg };
  }

  // Update route with new geometry and has_backtracking flag
  await db.query(
    `
    UPDATE railway_routes
    SET
      geometry = ST_GeomFromText($1, 4326),
      length_km = $2,
      has_backtracking = $3,
      is_valid = TRUE,
      error_message = NULL,
      -- The route routes again, so whatever works had broken it are over.
      -- The failure branches leave the flag alone: a route still under
      -- repair keeps it across OSM updates until it recalculates.
      under_repair = FALSE,
      updated_at = CURRENT_TIMESTAMP
    WHERE track_id = $4
  `,
    [lineString, newLength, recalcResult.hasBacktracking || false, track_id],
  );

  return { status: "recalculated", hasBacktracking: recalcResult.hasBacktracking || false };
}

/**
 * Recalculate all railway routes based on stored coordinates
 *
 * Routes are recalculated `concurrency` at a time. This needs a Pool rather than
 * a Client: node-pg serialises concurrent queries on a single connection, so
 * workers sharing one would queue behind each other and gain nothing.
 */
export async function recalculateAllRoutes(
  db: Pool,
  options: RecalculationOptions = {},
): Promise<RecalculationResult> {
  const concurrency = options.concurrency ?? DEFAULT_RECALC_CONCURRENCY;

  console.log(
    options.validOnly
      ? "Recalculating valid railway routes (skipping already-invalid)..."
      : "Recalculating all railway routes...",
  );

  const result: RecalculationResult = {
    totalRoutes: 0,
    successfulRoutes: 0,
    invalidRoutes: 0,
    backtrackingRoutes: [],
    errors: [],
  };

  // Only what recalculation actually reads. Notably not the existing geometry:
  // it is replaced wholesale, and ST_AsGeoJSON'ing every route's full linestring
  // just to discard it was costing a serialise-and-ship per route.
  const routes = await db.query<RouteRow>(`
    SELECT
      track_id,
      from_station,
      to_station,
      ST_X(starting_coordinate) as start_lng,
      ST_Y(starting_coordinate) as start_lat,
      ST_X(ending_coordinate) as end_lng,
      ST_Y(ending_coordinate) as end_lat,
      length_km,
      intended_backtracking
    FROM railway_routes
    WHERE starting_coordinate IS NOT NULL
      AND ending_coordinate IS NOT NULL
      ${options.validOnly ? "AND is_valid IS NOT FALSE" : ""}
    ORDER BY track_id
  `);

  result.totalRoutes = routes.rows.length;
  console.log(`Found ${result.totalRoutes} routes to recalculate (${concurrency} at a time)`);

  // Outcomes are collected by index, so the summary reads in track_id order
  // however the workers happen to interleave.
  const outcomes: RouteOutcome[] = new Array(result.totalRoutes);
  let nextIndex = 0;
  let processed = 0;
  let aborted = false;

  const worker = async (): Promise<void> => {
    while (!aborted) {
      const index = nextIndex++;
      if (index >= routes.rows.length) return;

      try {
        outcomes[index] = await recalculateAndStoreRoute(db, routes.rows[index]);
      } catch (error) {
        // A pathfinding failure is already an outcome (see recalculateRoute), so
        // reaching here means the database itself is unhappy. Stop the other
        // workers from picking up more work and let it propagate, rather than
        // marking a route invalid over what is probably a transient fault.
        aborted = true;
        throw error;
      }

      processed++;
      if (processed % 10 === 0 || processed === result.totalRoutes) {
        process.stdout.write(`\r  ${processed}/${result.totalRoutes} routes recalculated...`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, routes.rows.length) }, () => worker()),
  );

  for (const [index, route] of routes.rows.entries()) {
    const outcome = outcomes[index];
    const { track_id, from_station, to_station, intended_backtracking } = route;

    if (outcome.status === "recalculated") {
      result.successfulRoutes++;

      // Track routes with unintended backtracking (hasBacktracking=true AND intended_backtracking=false)
      if (outcome.hasBacktracking && !intended_backtracking) {
        result.backtrackingRoutes.push({ track_id, from_station, to_station });
      }
    } else {
      result.invalidRoutes++;
      result.errors.push({ track_id, from_station, to_station, error: outcome.error });
    }
  }

  return result;
}

/**
 * Verify and recalculate routes if they exist in the database
 * Prints summary information to console
 */
export async function verifyAndRecalculateRoutes(
  db: Pool,
  options: RecalculationOptions = {},
): Promise<void> {
  // Check if there are routes to recalculate
  const routeCount = await db.query(`
    SELECT COUNT(*) as count
    FROM railway_routes
    WHERE starting_coordinate IS NOT NULL
      AND ending_coordinate IS NOT NULL
      ${options.validOnly ? "AND is_valid IS NOT FALSE" : ""}
  `);

  const hasRoutes = parseInt(routeCount.rows[0].count, 10) > 0;

  if (!hasRoutes) {
    console.log("");
    console.log("No routes found - skipping recalculation");
    return;
  }

  console.log("");
  const started = performance.now();
  // Recalculate all railway routes
  const recalcResult = await recalculateAllRoutes(db, options);
  const elapsedMinutes = (performance.now() - started) / 60000;

  console.log("\n");
  console.log("=== Route Recalculation Summary ===");
  console.log(`Total routes: ${recalcResult.totalRoutes}`);
  console.log(`Successfully recalculated: ${recalcResult.successfulRoutes}`);
  console.log(`Routes with unintended backtracking: ${recalcResult.backtrackingRoutes.length}`);
  console.log(`Invalid routes: ${recalcResult.invalidRoutes}`);
  console.log(`Time: ${elapsedMinutes.toFixed(1)} min`);

  if (recalcResult.backtrackingRoutes.length > 0) {
    console.log("");
    console.log("=== Routes with Unintended Backtracking ===");
    console.log("(Routes with hasBacktracking=true but intended_backtracking=false)");
    for (const route of recalcResult.backtrackingRoutes) {
      console.log(`  [${route.track_id}] ${route.from_station} → ${route.to_station}`);
    }
  }

  if (recalcResult.errors.length > 0) {
    console.log("");
    console.log("=== Invalid Routes ===");
    for (const error of recalcResult.errors) {
      console.log(
        `  [${error.track_id}] ${error.from_station} → ${error.to_station}: ${error.error}`,
      );
    }
  }
}

async function verifyRoutes(): Promise<void> {
  const args = process.argv.slice(2);
  const concurrency = parseConcurrencyArg(args);
  const pool = createRecalcPool(concurrency);

  try {
    console.log("Connected to database");

    const validOnly = args.includes("--valid-only");
    await verifyAndRecalculateRoutes(pool, { validOnly, concurrency });

    // Which stations the user map shows follows the route geometries this just moved
    console.log("");
    const client = await pool.connect();
    try {
      const proximity = await refreshAllStationProximity(client);
      console.log(
        `Stations within ${STATION_ROUTE_PROXIMITY_METERS}m of a route: ${proximity.near} of ${proximity.total}`,
      );
    } finally {
      client.release();
    }

    console.log("");
    console.log("Route verification completed!");
  } catch (error) {
    console.error("Error verifying routes:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script only if executed directly (not imported)
// Check if this file is being run directly by tsx
const isMainModule =
  process.argv[1]?.endsWith("verifyRouteData.ts") ||
  process.argv[1]?.endsWith("verifyRouteData.js");
if (isMainModule) {
  verifyRoutes().catch(console.error);
}
