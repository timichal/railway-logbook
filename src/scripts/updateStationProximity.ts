#!/usr/bin/env tsx
/**
 * Recompute stations.near_route
 *
 * Flags every station that has an admin-defined route running within 250m. Only
 * flagged stations reach the user map (public_stations_tile) and searchStations;
 * the admin map keeps showing all of them. importMapData and verifyRouteData do
 * this automatically once route geometries settle, and admin route writes refresh
 * the routes they touch — run this to backfill, or after loading a route dump.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";
import {
  refreshAllStationProximity,
  STATION_ROUTE_PROXIMITY_METERS,
} from "../lib/stationProximity";

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function updateStationProximity() {
  const client = await pool.connect();

  try {
    console.log(`Flagging stations within ${STATION_ROUTE_PROXIMITY_METERS}m of a route...`);
    console.log("=====================================\n");

    // Present on fresh databases (01-schema.sql), added here for older ones
    await client.query(`
      ALTER TABLE stations
      ADD COLUMN IF NOT EXISTS near_route BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // Short-lived predecessor, measured against railway_parts instead of routes
    await client.query(`ALTER TABLE stations DROP COLUMN IF EXISTS near_railway`);

    const { near, total } = await refreshAllStationProximity(client);
    console.log(`- Stations near a route: ${near} of ${total}`);

    console.log("\n=====================================");
    console.log("Station proximity flags updated!");
    console.log("=====================================\n");
  } catch (error) {
    console.error("Error updating station proximity:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
updateStationProximity().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
