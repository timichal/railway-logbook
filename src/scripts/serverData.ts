/**
 * Copy data from the server's database into a local file and into the local
 * database. Runs on your own machine; all the server does is `pg_dump`, streamed
 * back over plink (ssh off Windows), so nothing is left on the server. Its
 * checkout is consulted only to ask whether a deploy is running, and a failure to
 * answer is a warning, not a stop.
 *
 *   backup          the route data into data/backups/railway_data_<timestamp>.dump
 *   pull-routes     backup, then replace the local route data with it
 *   pull-all        backup, then replace the local map and route data with the
 *                   server's, so the local database mirrors it
 *   restore <file>  replace the local route data with an earlier backup
 *
 * "Route data" is everything that is not rebuilt from OSM: the routes, the admin
 * notes, and every user's account, preferences, trips, journeys and logged parts.
 * "Map data" is `stations` and `railway_parts`. The map is never pulled on its own
 * because the server's routes were recalculated against that very map data by the
 * deploy that put it there. Pulling both makes recalculating the local routes
 * (minutes) unnecessary, and the stations' `near_route` flags arrive already
 * matching the routes that come with them. For that to hold, both come out of one
 * pg_dump, i.e. one snapshot: two dumps would straddle anything committed between
 * them. The backup pull-all also leaves behind is a dump of its own.
 *
 * A restore replaces the tables whole inside one transaction: if any part fails,
 * the local database is left as it was.
 */

import "dotenv/config";
import { type StdioOptions, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import pool from "../lib/db";
import {
  refreshAllStationProximity,
  STATION_ROUTE_PROXIMITY_METERS,
} from "../lib/stationProximity";

const REMOTE_HOST = "railmap@railmap.zlatkovsky.cz";
const REMOTE_DIR = "/home/railmap/osm-trains";

/** The Postgres container, named alike by docker-compose.yml on both machines. */
const CONTAINER = "db";

/**
 * psql/pg_dump connection flags for use inside the container, whose environment
 * already names the database and its superuser, so neither machine's .env is
 * needed. Left unquoted on purpose: plink's command line only has to carry single
 * quotes, and neither value contains a space.
 */
const PG_CONNECT = "-U $POSTGRES_USER -d $POSTGRES_DB";

const ROUTE_TABLES = [
  "railway_routes",
  "admin_notes",
  "users",
  "user_preferences",
  "user_trips",
  "user_journeys",
  "user_logged_parts",
];
const MAP_TABLES = ["stations", "railway_parts"];
const ALL_TABLES = [...MAP_TABLES, ...ROUTE_TABLES];

const DATA_DIR = path.join(process.cwd(), "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

/**
 * Run a command to completion, throwing unless it exits 0. `step` says what was
 * being done, since "docker exited with status 1" could be any of several things.
 */
function run(
  step: string,
  command: string,
  args: string[],
  stdio: StdioOptions = "inherit",
): string {
  const result = spawnSync(command, args, { stdio, encoding: "utf-8" });
  if (result.error) throw new Error(`${step} failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${step} failed (${command} exited with status ${result.status})`);
  }
  return result.stdout ?? "";
}

/**
 * Run a shell command on the server; plink/ssh exit with the remote status. `-T`
 * because a dump is binary on stdout, and a pty (which a saved PuTTY session
 * could otherwise ask for) would turn its LFs into CRLFs.
 */
function remote(step: string, command: string, stdio: StdioOptions = "inherit"): string {
  return process.platform === "win32"
    ? run(step, "plink", ["-batch", "-T", REMOTE_HOST, command], stdio)
    : run(step, "ssh", ["-T", "-o", "BatchMode=yes", REMOTE_HOST, command], stdio);
}

/** Whether a map data deploy is running on the server; undefined if it cannot say. */
function deployIsRunning(): boolean | undefined {
  try {
    const state = remote(
      "Checking for a running deploy",
      `bash ${REMOTE_DIR}/osmium-scripts/remote-deploy.sh --state`,
      ["ignore", "pipe", "inherit"],
    );
    return state.trim() === "running";
  } catch (error) {
    console.warn(`Warning: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

/**
 * During a deploy the server's routes are mid-recalculation, so a pull would copy
 * a half-updated network. A backup only warns: the user data in it is whole either
 * way. Neither stops when the server cannot say, since the dump itself does not
 * need the checkout that answers.
 */
function checkNoDeploy(refuse: boolean): void {
  const running = deployIsRunning();
  if (running && refuse) {
    throw new Error(
      "A map data deploy is running on the server, so its routes are mid-recalculation. " +
        "Pull once it has finished (npm run deployMapData -- --follow).",
    );
  }
  if (running) {
    console.warn("Note: a map data deploy is running; route geometry may be mid-recalculation.");
  } else if (running === undefined) {
    console.warn("Could not tell whether a deploy is running - continuing.");
  }
}

function megabytes(file: string): string {
  return `${(fs.statSync(file).size / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * Copy a local dump into the container for as long as `use` runs, so the
 * verification and the restore read one copy rather than each streaming the file
 * in again.
 */
function inContainer(file: string, use: (containerFile: string) => void): void {
  const containerFile = `/tmp/${path.basename(file)}`;
  try {
    run("Copying the dump into the container", "docker", [
      "cp",
      file,
      `${CONTAINER}:${containerFile}`,
    ]);
    use(containerFile);
  } finally {
    spawnSync("docker", ["exec", CONTAINER, "rm", "-f", containerFile], { stdio: "ignore" });
  }
}

/**
 * Check that a dump (already in the container) holds data for exactly `tables`
 * and reads to the end. The full read is what catches a truncated download: the
 * table of contents comes first, so a listing alone would pass one.
 */
function verifyDump(containerFile: string, tables: string[], name: string): void {
  const listing = run(
    `Reading the table list of ${name}`,
    "docker",
    ["exec", CONTAINER, "pg_restore", "--list", containerFile],
    ["ignore", "pipe", "inherit"],
  );
  const inDump = [...listing.matchAll(/^\d+; \d+ \d+ TABLE DATA public (\S+) /gm)].map(
    (match) => match[1],
  );
  const missing = tables.filter((table) => !inDump.includes(table));
  const unexpected = inDump.filter((table) => !tables.includes(table));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${name} is not the expected dump (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`,
    );
  }

  run(`Reading ${name} to the end`, "docker", [
    "exec",
    CONTAINER,
    "pg_restore",
    "-f",
    "/dev/null",
    containerFile,
  ]);
}

/**
 * Dump `tables` from the server's database straight into a local file, verify
 * it, and hand its container copy to `andThen`. Written under a temporary name
 * until verified, so an interrupted download never leaves a file that looks like
 * a finished one.
 */
function download(tables: string[], file: string, andThen?: (containerFile: string) => void): void {
  const partFile = `${file}.part`;
  const tableArgs = tables.map((table) => `--table=public.${table}`).join(" ");
  try {
    const fd = fs.openSync(partFile, "w");
    try {
      remote(
        "Downloading from the server",
        `docker exec ${CONTAINER} sh -c 'pg_dump ${PG_CONNECT} --data-only --format=custom --compress=zstd ${tableArgs}'`,
        ["ignore", fd, "inherit"],
      );
    } finally {
      fs.closeSync(fd);
    }
    inContainer(partFile, (containerFile) => {
      verifyDump(containerFile, tables, path.basename(file));
      fs.renameSync(partFile, file);
      andThen?.(containerFile);
    });
  } finally {
    fs.rmSync(partFile, { force: true });
  }
}

function downloadRouteBackup(andThen?: (containerFile: string) => void): void {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/:/g, "-").split(".")[0];
  const file = path.join(BACKUP_DIR, `railway_data_${timestamp}.dump`);
  console.log("Downloading route data from the server...");
  download(ROUTE_TABLES, file, (containerFile) => {
    console.log(`✓ Saved to ${path.relative(process.cwd(), file)} (${megabytes(file)})`);
    andThen?.(containerFile);
  });
}

/**
 * Replace `tables` in the local database with a dump's contents, in one
 * transaction. The COMMIT is sent only once pg_restore has succeeded, and
 * pipefail carries a pg_restore failure out as the exit status. Otherwise psql
 * would reach the end of its input with the transaction still open, roll it back
 * and exit 0, and a failed restore would be reported as a success.
 *
 * Triggers are off for the load (`session_replication_role = replica`): the dump
 * already carries the columns they would compute (`geometry_3857`), and with them
 * go the foreign key checks, which a table-at-a-time load would trip in between
 * tables. TRUNCATE rather than DELETE, as there is no one to block locally.
 */
function restore(containerFile: string, tables: string[]): void {
  run("Restoring into the local database", "docker", [
    "exec",
    CONTAINER,
    "sh",
    "-c",
    `set -o pipefail; { echo "BEGIN; SET session_replication_role = replica; TRUNCATE ${tables.join(", ")};" && pg_restore -f - ${containerFile} && echo "COMMIT;"; } | psql -X -q -v ON_ERROR_STOP=1 ${PG_CONNECT} > /dev/null`,
  ]);
}

/** The routes changed under the stations, and `near_route` is derived from them. */
async function refreshProximity(): Promise<void> {
  const client = await pool.connect();
  try {
    const { near, total } = await refreshAllStationProximity(client);
    console.log(
      `✓ Stations within ${STATION_ROUTE_PROXIMITY_METERS}m of a route: ${near} of ${total}`,
    );
  } finally {
    client.release();
  }
}

async function printLocalCounts(tables: string[]): Promise<void> {
  const counts = await pool.query<Record<string, string>>(
    `SELECT ${tables.map((table) => `(SELECT count(*) FROM ${table}) AS ${table}`).join(", ")}`,
  );
  for (const table of tables) {
    console.log(`  ${table}: ${counts.rows[0][table]}`);
  }
}

/**
 * The old export was a plain .sql script, which pg_restore rejects with a message
 * about psql - true, and the one thing not to do with those files (see CLAUDE.md).
 */
function assertCustomFormat(file: string): void {
  const fd = fs.openSync(file, "r");
  const magic = Buffer.alloc(5);
  try {
    fs.readSync(fd, magic, 0, 5, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (magic.toString("latin1") !== "PGDMP") {
    throw new Error(
      `${file} is not a backup made by backupRouteData. Old .sql exports are a different ` +
        'format and cannot be restored by this script - see "Server data" in CLAUDE.md.',
    );
  }
}

const USAGE = `Usage:
  npm run backupRouteData
  npm run pullRouteData
  npm run pullAllData
  npm run restoreRouteData <file.dump>`;

async function main(): Promise<void> {
  const [mode, fileArg] = process.argv.slice(2);
  const started = Date.now();

  switch (mode) {
    case "backup": {
      checkNoDeploy(false);
      downloadRouteBackup();
      break;
    }

    case "pull-routes": {
      checkNoDeploy(true);
      downloadRouteBackup((containerFile) => {
        console.log("\nReplacing the local route data...");
        restore(containerFile, ROUTE_TABLES);
      });
      await printLocalCounts(ROUTE_TABLES);
      await refreshProximity();
      console.log(
        "Note: route geometry and validity are the server's, computed against its map data. " +
          "If the local map data is older, npm run pullAllData brings both in line.",
      );
      break;
    }

    case "pull-all": {
      checkNoDeploy(true);
      downloadRouteBackup();
      console.log("\nDownloading map and route data from the server...");
      const file = path.join(DATA_DIR, "server_data.dump");
      try {
        download(ALL_TABLES, file, (containerFile) => {
          console.log(`✓ Downloaded (${megabytes(file)})`);
          console.log("\nReplacing the local map and route data...");
          restore(containerFile, ALL_TABLES);
        });
      } finally {
        fs.rmSync(file, { force: true });
      }
      await printLocalCounts(ALL_TABLES);
      break;
    }

    case "restore": {
      if (!fileArg || !fs.existsSync(fileArg)) {
        throw new Error(fileArg ? `File not found: ${fileArg}` : USAGE);
      }
      assertCustomFormat(fileArg);
      inContainer(fileArg, (containerFile) => {
        verifyDump(containerFile, ROUTE_TABLES, path.basename(fileArg));
        console.log(`Replacing the local route data with ${fileArg}...`);
        restore(containerFile, ROUTE_TABLES);
      });
      await printLocalCounts(ROUTE_TABLES);
      await refreshProximity();
      break;
    }

    default:
      throw new Error(USAGE);
  }

  console.log(`\n✓ Done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

main()
  .catch((error) => {
    console.error(`\nError: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
