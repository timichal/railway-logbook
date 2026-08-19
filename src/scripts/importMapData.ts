import dotenv from "dotenv";
import {
  refreshAllStationProximity,
  STATION_ROUTE_PROXIMITY_METERS,
} from "../lib/stationProximity";
import { loadStationsAndParts } from "./lib/loadRailwayData";
import {
  createRecalcPool,
  parseConcurrencyArg,
  verifyAndRecalculateRoutes,
} from "./verifyRouteData";

dotenv.config();

async function loadGeoJSONData(): Promise<void> {
  // A pool rather than a single client: step 2 recalculates several routes at
  // once, and node-pg serialises concurrent queries on one connection.
  let pool: ReturnType<typeof createRecalcPool> | undefined;

  try {
    // Parse CLI args: every non-flag positional is a data file path. One file
    // per region (see src/lib/regions.ts) - they load into the same tables, and
    // the tables are cleared once before the first file, so all regions must be
    // passed to a single run.
    const args = process.argv.slice(2);
    const validOnly = args.includes("--valid-only");
    const concurrency = parseConcurrencyArg(args);
    const dataPaths = args.filter((arg) => !arg.startsWith("--"));

    const usage = () => {
      console.error(
        "Usage: npm run importMapData <filepath> [<filepath> ...] [--valid-only] [--concurrency=N]",
      );
      console.error(
        "Example: npm run importMapData ./data/europe-pruned-251027.geojson ./data/japan-pruned-251027.geojson",
      );
    };

    if (dataPaths.length === 0) {
      console.error("Error: At least one data file path is required");
      usage();
      process.exit(1);
    }

    // Validate file extensions
    const badPath = dataPaths.find((path) => !path.toLowerCase().endsWith(".geojson"));
    if (badPath) {
      console.error("Error: File must be a .geojson file");
      console.error(`Provided file: ${badPath}`);
      usage();
      process.exit(1);
    }

    console.log(`Using data files: ${dataPaths.join(", ")}`);

    pool = createRecalcPool(concurrency);
    console.log("Connected to database");

    // Step 1: Load stations and railway parts from pruned GeoJSON.
    // One dedicated session, because the load runs as a single transaction.
    console.log("");
    console.log("=== Step 1: Loading map data ===");
    const loader = await pool.connect();
    try {
      await loadStationsAndParts(loader, dataPaths);
    } finally {
      loader.release();
    }

    // Step 2: Verify and recalculate routes if they exist
    console.log("");
    console.log(
      validOnly
        ? "=== Step 2: Verifying routes (valid only — skipping already-invalid) ==="
        : "=== Step 2: Verifying routes ===",
    );
    await verifyAndRecalculateRoutes(pool, { validOnly, concurrency });

    // Step 3: Route geometries have just settled, so the station flags derived
    // from them are refreshed last
    console.log("");
    console.log("=== Step 3: Flagging stations near routes ===");
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
    console.log("Database update completed!");
  } catch (error) {
    console.error("Error loading data:", error);
    process.exit(1);
  } finally {
    await pool?.end();
  }
}

// Run the script
loadGeoJSONData().catch(console.error);
