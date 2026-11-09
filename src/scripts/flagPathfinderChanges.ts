#!/usr/bin/env tsx
/**
 * TEMPORARY (see `src/lib/pathfinderChange.ts`). Mark invalid every valid open
 * route and valid scenic line whose path the current pathfinder would move, so
 * each is re-picked by hand instead of being saved unseen by the next
 * recalculation.
 *
 * Run it once the app with the new pathfinder is deployed and **before the next
 * map data deploy**: the stored geometry is then what the old search found on
 * the same map, so a difference is the search's doing and nothing else. After a
 * map deploy, the recalculation has already saved the small changes and marked
 * the large ones "Distance mismatch".
 *
 * "Moved" is the stored and the new path lying more than `--threshold` metres
 * apart anywhere (Hausdorff distance, default `DEFAULT_THRESHOLD_METERS`). Below
 * it is a switch between parallel tracks or crossovers in a station, which the
 * next recalculation saves as it saves any OSM retouch.
 *
 *   npm run flagPathfinderChanges -- [--dry-run] [--threshold=M] [--concurrency=N]
 *
 * `--dry-run` lists what would be marked and writes nothing. Writes, like the
 * recalculation's, are conditional on the line still being valid (and a route
 * open), and one per line, never one transaction.
 */

import type { Pool } from "pg";
import { coordinatesToWKT } from "../lib/coordinateUtils";
import { lineLengthKmSql } from "../lib/lineLength";
import { PATHFINDER_CHANGE_ERROR } from "../lib/pathfinderChange";
import { RailwayPathFinder } from "./lib/railwayPathFinder";
import { runPool } from "./lib/runPool";
import { createRecalcPool, parseConcurrencyArg } from "./verifyRouteData";

/**
 * Parallel tracks lie 4–5m apart and a station's fan of them a few tens of
 * metres; a different line through other junctions is hundreds.
 */
const DEFAULT_THRESHOLD_METERS = 50;

type Table = "railway_routes" | "scenic_lines";

interface LineRow {
  id: number;
  from_station: string;
  to_station: string;
  start_point: [number, number];
  end_point: [number, number];
  length_km: number;
}

interface Change {
  table: Table;
  row: LineRow;
  error: string;
}

const LINE_COLUMNS = `
  from_station,
  to_station,
  ARRAY[ST_X(starting_coordinate), ST_Y(starting_coordinate)] AS start_point,
  ARRAY[ST_X(ending_coordinate), ST_Y(ending_coordinate)] AS end_point,
  length_km`;

/** The SQL that picks out one line of `table` by id. */
const idColumn = (table: Table) => (table === "railway_routes" ? "track_id" : "id");

/**
 * Why the line is flagged, or null if the new search leaves it where it is.
 * A line it no longer routes at all is flagged too: that is the search's doing
 * as well, since the map hasn't changed.
 */
async function findChange(
  db: Pool,
  table: Table,
  row: LineRow,
  thresholdMeters: number,
): Promise<string | null> {
  const finder = new RailwayPathFinder({
    quiet: true,
    avoidBacktracking: table === "scenic_lines",
  });
  const path = await finder.findPathFromCoordinates(db, row.start_point, row.end_point);
  if (!path) return `${PATHFINDER_CHANGE_ERROR}: no path found`;

  // Metres from EPSG:3857 units, scaled at the line's latitude as `withinMetersSql` does
  const measured = await db.query<{ apart_m: number; new_length_km: number }>(
    `
    SELECT
      ST_HausdorffDistance(ST_Transform(geometry, 3857), ST_Transform(ST_GeomFromText($1, 4326), 3857))
        * cos(radians(ST_Y(starting_coordinate))) AS apart_m,
      ${lineLengthKmSql("$1")} AS new_length_km
    FROM ${table}
    WHERE ${idColumn(table)} = $2
    `,
    [coordinatesToWKT(path.coordinates), row.id],
  );
  const { apart_m, new_length_km } = measured.rows[0];
  if (apart_m <= thresholdMeters) return null;

  return `${PATHFINDER_CHANGE_ERROR}: stored ${row.length_km.toFixed(2)} km, now ${new_length_km.toFixed(2)} km, up to ${Math.round(apart_m)} m apart${path.hasBacktracking ? ", backtracks" : ""}`;
}

async function flagTable(
  db: Pool,
  table: Table,
  options: { thresholdMeters: number; concurrency: number; dryRun: boolean },
): Promise<Change[]> {
  // The lines a recalculation would recalculate (verifyRouteData)
  const rows = await db.query<LineRow>(`
    SELECT ${idColumn(table)} AS id, ${LINE_COLUMNS}
    FROM ${table}
    WHERE is_valid ${table === "railway_routes" ? "AND NOT closed" : ""}
    ORDER BY ${idColumn(table)}
  `);
  console.log(`${table}: checking ${rows.rows.length}...`);

  const errors = await runPool(
    rows.rows,
    options.concurrency,
    (row) => findChange(db, table, row, options.thresholdMeters),
    (done) => {
      if (done % 50 === 0 || done === rows.rows.length) {
        process.stdout.write(`\r  ${done}/${rows.rows.length}`);
      }
    },
  );
  console.log("");

  const changes: Change[] = [];
  for (const [index, row] of rows.rows.entries()) {
    const error = errors[index];
    if (error === null) continue;
    if (!options.dryRun) {
      const marked = await db.query(
        `UPDATE ${table} SET is_valid = FALSE, error_message = $1
         WHERE ${idColumn(table)} = $2 AND is_valid ${table === "railway_routes" ? "AND NOT closed" : ""}`,
        [error, row.id],
      );
      if (marked.rowCount === 0) continue; // Changed by the admin meanwhile
    }
    changes.push({ table, row, error });
  }
  return changes;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const thresholdArg = args.find((arg) => arg.startsWith("--threshold="));
  const thresholdMeters = thresholdArg
    ? Number(thresholdArg.slice("--threshold=".length))
    : DEFAULT_THRESHOLD_METERS;
  if (!Number.isFinite(thresholdMeters) || thresholdMeters < 0) {
    throw new Error(`Invalid ${thresholdArg}`);
  }
  const concurrency = parseConcurrencyArg(args);
  const db = createRecalcPool(concurrency);

  try {
    console.log(
      `${dryRun ? "[dry run] " : ""}Flagging lines the new pathfinder moves by more than ${thresholdMeters} m`,
    );
    const options = { thresholdMeters, concurrency, dryRun };
    const changes = [
      ...(await flagTable(db, "railway_routes", options)),
      ...(await flagTable(db, "scenic_lines", options)),
    ];

    console.log("");
    for (const { table, row, error } of changes) {
      const what = table === "railway_routes" ? "route" : "scenic line";
      console.log(`  ${what} ${row.id}  ${row.from_station} → ${row.to_station}: ${error}`);
    }
    console.log("");
    console.log(
      `${changes.length} line(s) ${dryRun ? "would be marked" : "marked"} invalid as "${PATHFINDER_CHANGE_ERROR}"`,
    );
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("Error flagging pathfinder changes:", error);
  process.exit(1);
});
