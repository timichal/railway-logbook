#!/usr/bin/env tsx
/**
 * Recompute stations.near_railway
 *
 * Flags every station that has a railway part running within 250m. Only flagged
 * stations are served to the user map (public_stations_tile); the admin map keeps
 * showing all of them. importMapData does this automatically at the end of a load —
 * run this to backfill a database loaded before the column existed.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";
import { STATION_RAIL_PROXIMITY_METERS, updateStationRailProximity } from "./lib/loadRailwayData";

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function updateStationProximity() {
  const client = await pool.connect();

  try {
    console.log(`Flagging stations within ${STATION_RAIL_PROXIMITY_METERS}m of a railway part...`);
    console.log("=====================================\n");

    // Present on fresh databases (01-schema.sql), added here for older ones
    await client.query(`
      ALTER TABLE stations
      ADD COLUMN IF NOT EXISTS near_railway BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await updateStationRailProximity(client);

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
