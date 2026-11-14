#!/usr/bin/env tsx
/**
 * Add `data_versions` and the trigger that bumps its `railway_routes` row
 *
 * The counter `routesFingerprint` reads instead of scanning `railway_routes`
 * (why it is a row and why the trigger is deferred: the comments beside both in
 * 01-schema.sql). The SQL here is a copy of that, made idempotent.
 *
 * Idempotent — safe to re-run. Run it before the app deploy that ships
 * `routesFingerprint`'s read of the table: without it every routes-cached answer
 * (route details, summaries, track ids) and every planner search fails.
 */

import pool from "../lib/db";

async function addDataVersions() {
  const client = await pool.connect();

  try {
    console.log("Adding data_versions...");
    console.log("=====================================\n");

    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS data_versions (
        table_name TEXT PRIMARY KEY,
        version BIGINT NOT NULL,
        bumped_in XID8
      );

      INSERT INTO data_versions (table_name, version)
      VALUES ('railway_routes', (extract(epoch FROM clock_timestamp()) * 1000)::bigint)
      ON CONFLICT (table_name) DO NOTHING;
    `);
    console.log("✓ Table data_versions present, with its railway_routes row");

    await client.query(`
      CREATE OR REPLACE FUNCTION bump_data_version()
      RETURNS TRIGGER AS $$
      BEGIN
          UPDATE data_versions
          SET version = version + 1, bumped_in = pg_current_xact_id()
          WHERE table_name = TG_TABLE_NAME AND bumped_in IS DISTINCT FROM pg_current_xact_id();
          RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS railway_routes_bump_version ON railway_routes;
      CREATE CONSTRAINT TRIGGER railway_routes_bump_version
      AFTER INSERT OR UPDATE OR DELETE ON railway_routes
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      EXECUTE FUNCTION bump_data_version();

      DROP TRIGGER IF EXISTS railway_routes_bump_version_truncate ON railway_routes;
      CREATE TRIGGER railway_routes_bump_version_truncate
      AFTER TRUNCATE ON railway_routes
      FOR EACH STATEMENT
      EXECUTE FUNCTION bump_data_version();
    `);
    console.log(
      "✓ Triggers railway_routes_bump_version, railway_routes_bump_version_truncate present",
    );

    await client.query("COMMIT");

    console.log("\n=====================================");
    console.log("Done");
    console.log("=====================================\n");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error adding data_versions:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
addDataVersions().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
