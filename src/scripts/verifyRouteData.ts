import type { Pool } from "pg";
import { SCENIC_BACKTRACKING_ERROR } from "../lib/adminValidation";
import { coordinatesToWKT } from "../lib/coordinateUtils";
import { createPool } from "../lib/db";
import { lineLengthKmSql } from "../lib/lineLength";
import { formatStationProximity, refreshAllStationProximity } from "../lib/stationProximity";
import { RailwayPathFinder } from "./lib/railwayPathFinder";
import { runPool } from "./lib/runPool";

/**
 * How many routes are recalculated at once by default.
 *
 * Every route is recalculated independently of every other one, so this is the
 * one part of the import that parallelises for free. The ceiling is memory, not
 * Postgres: each worker holds its own bufferful of parsed part geometry, which
 * is why `importMapData` runs with a raised heap limit. Raise it by measuring,
 * not by guessing.
 */
const DEFAULT_RECALC_CONCURRENCY = 4;

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
  return createPool({ max: concurrency + 2 });
}

interface RecalculationResult {
  totalRoutes: number;
  successfulRoutes: number;
  invalidRoutes: number;
  backtrackingRoutes: Array<{ track_id: number; from_station: string; to_station: string }>;
  errors: Array<{ track_id: number; from_station: string; to_station: string; error: string }>;
}

interface RecalculationOptions {
  /** Skip routes already marked invalid (is_valid = FALSE); only recalculate valid ones. */
  validOnly?: boolean;
  /** Routes to recalculate at once. Defaults to DEFAULT_RECALC_CONCURRENCY. */
  concurrency?: number;
}

/** What a route and a scenic line share, as read for recalculation. */
interface StoredGeometryRow {
  from_station: string;
  to_station: string;
  start_point: [number, number];
  end_point: [number, number];
  length_km: number;
}

/**
 * The columns behind StoredGeometryRow. Only what recalculation actually reads.
 * Notably not the existing geometry: it is replaced wholesale, and
 * ST_AsGeoJSON'ing every route's full linestring just to discard it was costing
 * a serialise-and-ship per route.
 */
const STORED_GEOMETRY_COLUMNS = `
  from_station,
  to_station,
  ARRAY[ST_X(starting_coordinate), ST_Y(starting_coordinate)] AS start_point,
  ARRAY[ST_X(ending_coordinate), ST_Y(ending_coordinate)] AS end_point,
  length_km`;

/** One route as read from the database, ready to recalculate. */
interface RouteRow extends StoredGeometryRow {
  track_id: number;
  intended_backtracking: boolean;
}

/** What became of one route. Aggregated into RecalculationResult in track_id order. */
type RouteOutcome =
  | { status: "recalculated"; hasBacktracking: boolean }
  | { status: "invalid"; error: string };

/**
 * Recalculate a geometry from its stored click points and judge it against the
 * stored length: what a route and a scenic line have in common. Writes nothing.
 * `avoidBacktracking` for a scenic line, searched as its save searched it.
 */
async function recalculateGeometry(
  db: Pool,
  row: StoredGeometryRow,
  { avoidBacktracking = false }: { avoidBacktracking?: boolean } = {},
): Promise<
  | { status: "invalid"; error: string }
  | { status: "ok"; lineString: string; newLength: number; hasBacktracking: boolean }
> {
  const originalLength = row.length_km;

  // Quiet rather than silenced from outside: a bulk run makes thousands of these
  // searches, several at a time, and their progress logging would bury the
  // summary. See PathFinderOptions for why patching the global console.log —
  // which is what this used to do — cannot survive two overlapping searches.
  const pathFinder = new RailwayPathFinder({ quiet: true, avoidBacktracking });

  // Deliberately no try/catch. Every way pathfinding can fail comes back as
  // null — the one failure that throws, a part combination whose chain doesn't
  // connect ("Chain is broken"), is caught per combination inside the finder —
  // so what does throw is the part-loading query or a bug. Catching it here
  // used to write e.g. "Connection terminated unexpectedly" as the route's
  // error_message with is_valid = FALSE, and a `--valid-only` run (every
  // deploy) then never looked at the route again. Let it stop the run instead.
  const path = await pathFinder.findPathFromCoordinates(db, row.start_point, row.end_point);
  if (!path) {
    return { status: "invalid", error: "No path found between starting and ending coordinates" };
  }

  const lineString = coordinatesToWKT(path.coordinates);
  const lengthQuery = await db.query<{ new_length_km: number }>(
    `SELECT ${lineLengthKmSql("$1")} AS new_length_km`,
    [lineString],
  );

  const newLength = lengthQuery.rows[0].new_length_km;
  const lengthDiff = Math.abs(newLength - originalLength);
  const lengthDiffPercent = (lengthDiff / originalLength) * 100;

  // A row with no usable stored length (NULL or 0) has nothing to compare
  // against — the percentage would be NaN/Infinity — so accept the
  // recalculated geometry, which also backfills the missing length.
  const comparable = Number.isFinite(originalLength) && originalLength > 0;

  // Check if the new length differs significantly from the original
  // Consider invalid if difference is more than 0.1 km AND more than 1%
  if (comparable && lengthDiff > 0.1 && lengthDiffPercent > 1) {
    return {
      status: "invalid",
      error: `Distance mismatch: original ${originalLength.toFixed(2)} km, recalculated ${newLength.toFixed(2)} km (diff: ${lengthDiff.toFixed(2)} km, ${lengthDiffPercent.toFixed(1)}%)`,
    };
  }

  return { status: "ok", lineString, newLength, hasBacktracking: path.hasBacktracking ?? false };
}

/**
 * Recalculate one route and write the outcome.
 *
 * The UPDATE is autocommitted, one per route — deliberately not wrapped in a
 * transaction spanning the whole run, which would hold row locks on
 * `railway_routes` for the length of the import.
 */
async function recalculateAndStoreRoute(db: Pool, route: RouteRow): Promise<RouteOutcome> {
  const outcome = await recalculateGeometry(db, route);

  if (outcome.status === "invalid") {
    await db.query(
      `
      UPDATE railway_routes
      SET
        is_valid = FALSE,
        error_message = $1
      WHERE track_id = $2
    `,
      [outcome.error, route.track_id],
    );

    return outcome;
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
      under_repair = FALSE
    WHERE track_id = $4
  `,
    [outcome.lineString, outcome.newLength, outcome.hasBacktracking, route.track_id],
  );

  return { status: "recalculated", hasBacktracking: outcome.hasBacktracking };
}

/**
 * Recalculate all railway routes based on stored coordinates
 *
 * Routes are recalculated `concurrency` at a time. This needs a Pool rather than
 * a Client: node-pg serialises concurrent queries on a single connection, so
 * workers sharing one would queue behind each other and gain nothing.
 */
async function recalculateAllRoutes(
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

  const routes = await db.query<RouteRow>(`
    SELECT track_id, intended_backtracking, ${STORED_GEOMETRY_COLUMNS}
    FROM railway_routes
    ${options.validOnly ? "WHERE is_valid" : ""}
    ORDER BY track_id
  `);

  result.totalRoutes = routes.rows.length;
  console.log(`Found ${result.totalRoutes} routes to recalculate (${concurrency} at a time)`);

  // A pathfinding failure is already an outcome (see recalculateGeometry), so a
  // throw means the database itself is unhappy (or a bug): runPool stops the run
  // rather than marking a route invalid over what is probably a transient fault.
  // Outcomes come back in track_id order, so the summary reads that way too.
  const outcomes = await runPool(
    routes.rows,
    concurrency,
    (route) => recalculateAndStoreRoute(db, route),
    (processed) => {
      if (processed % 10 === 0 || processed === result.totalRoutes) {
        process.stdout.write(`\r  ${processed}/${result.totalRoutes} routes recalculated...`);
      }
    },
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

/** One scenic line as read from the database, ready to recalculate. */
interface ScenicLineRow extends StoredGeometryRow {
  id: number;
}

/**
 * Recalculate every scenic line from its stored click points, exactly as routes
 * are (same pathfinder, same length check), and print a summary. A line that no
 * longer routes, or whose new path backtracks (which a save refuses outright), is
 * marked invalid and keeps its last geometry, which the user map goes on drawing
 * — it is only a highlight.
 */
async function recalculateScenicLines(db: Pool, options: RecalculationOptions): Promise<void> {
  const lines = await db.query<ScenicLineRow>(`
    SELECT id, ${STORED_GEOMETRY_COLUMNS}
    FROM scenic_lines
    ${options.validOnly ? "WHERE is_valid" : ""}
    ORDER BY id
  `);
  if (lines.rows.length === 0) return;

  console.log("");
  console.log(`Recalculating ${lines.rows.length} scenic lines...`);
  const outcomes = await runPool(
    lines.rows,
    options.concurrency ?? DEFAULT_RECALC_CONCURRENCY,
    async (line) => {
      const recalculated = await recalculateGeometry(db, line, { avoidBacktracking: true });
      const outcome =
        recalculated.status === "ok" && recalculated.hasBacktracking
          ? { status: "invalid" as const, error: SCENIC_BACKTRACKING_ERROR }
          : recalculated;
      if (outcome.status === "invalid") {
        await db.query(
          "UPDATE scenic_lines SET is_valid = FALSE, error_message = $1 WHERE id = $2",
          [outcome.error, line.id],
        );
      } else {
        await db.query(
          `
          UPDATE scenic_lines
          SET geometry = ST_GeomFromText($1, 4326), length_km = $2, is_valid = TRUE, error_message = NULL
          WHERE id = $3
          `,
          [outcome.lineString, outcome.newLength, line.id],
        );
      }
      return outcome;
    },
  );

  const invalid = lines.rows.flatMap((line, index) => {
    const outcome = outcomes[index];
    return outcome.status === "invalid" ? [{ line, error: outcome.error }] : [];
  });

  console.log("");
  console.log("=== Scenic Line Recalculation Summary ===");
  console.log(`Total scenic lines: ${lines.rows.length}`);
  console.log(`Invalid scenic lines: ${invalid.length}`);
  for (const { line, error } of invalid) {
    console.log(`  [${line.id}] ${line.from_station} → ${line.to_station}: ${error}`);
  }
}

/** Recalculate the routes, then the scenic lines, printing a summary of each. */
export async function verifyAndRecalculateRoutes(
  db: Pool,
  options: RecalculationOptions = {},
): Promise<void> {
  console.log("");
  const started = performance.now();
  const recalcResult = await recalculateAllRoutes(db, options);
  const elapsedMinutes = (performance.now() - started) / 60000;

  // An empty table is the initial import. No summary: deploy.sh replays it at the
  // end, where a block of zeros would read as a recalculation that ran.
  if (recalcResult.totalRoutes === 0) {
    console.log("No routes found - skipping recalculation");
    await recalculateScenicLines(db, options);
    return;
  }

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

  // Inside the route summary's span of the log, which deploy.sh prints again at the end
  await recalculateScenicLines(db, options);
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
    console.log(formatStationProximity(await refreshAllStationProximity(pool)));

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
