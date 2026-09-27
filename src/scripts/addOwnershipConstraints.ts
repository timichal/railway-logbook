#!/usr/bin/env tsx
/**
 * Add the ownership constraints to an existing database
 *
 * `database/init/01-schema.sql` now ties a journey's trip, and a logged part's
 * journey, to the same user with composite foreign keys: `UNIQUE (id, user_id)`
 * on user_trips and user_journeys, then `(trip_id, user_id)` and
 * `(journey_id, user_id)` referencing them in place of the single-column FKs.
 * A fresh database gets them from the schema; this brings an older one level.
 *
 * Before adding them it repairs what they would reject. A journey filed under
 * another user's trip (which createJourney allowed until the ownership check
 * was added) is unfiled — the journey is its owner's, the link is what was
 * never legitimate. A logged part whose user differs from its journey's has no
 * such obvious answer, so the script lists those and stops.
 *
 * One transaction, and safe to rerun: a constraint already present is left as
 * it is.
 */

import dotenv from "dotenv";
import { Pool, type PoolClient } from "pg";
import { getDbConfig } from "../lib/dbConfig";

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

async function constraintExists(client: PoolClient, name: string): Promise<boolean> {
  const result = await client.query("SELECT 1 FROM pg_constraint WHERE conname = $1", [name]);
  return result.rows.length > 0;
}

async function addConstraint(client: PoolClient, table: string, name: string, definition: string) {
  if (await constraintExists(client, name)) {
    console.log(`  = ${table}.${name} already present`);
    return;
  }
  await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
  console.log(`  + ${table}.${name}`);
}

async function addOwnershipConstraints() {
  const client = await pool.connect();

  try {
    console.log("Adding ownership constraints...");
    console.log("=====================================\n");

    await client.query("BEGIN");

    const foreignParts = await client.query(`
      SELECT ulp.id, ulp.user_id, ulp.journey_id, uj.user_id AS journey_user_id
      FROM user_logged_parts ulp
      JOIN user_journeys uj ON uj.id = ulp.journey_id
      WHERE ulp.user_id <> uj.user_id
      ORDER BY ulp.id
    `);
    if (foreignParts.rows.length > 0) {
      console.error("Logged parts whose user differs from their journey's:");
      for (const row of foreignParts.rows) {
        console.error(
          `  part ${row.id}: user ${row.user_id}, journey ${row.journey_id} of user ${row.journey_user_id}`,
        );
      }
      throw new Error(`${foreignParts.rows.length} logged part(s) need resolving by hand`);
    }

    const unfiled = await client.query(`
      UPDATE user_journeys uj
      SET trip_id = NULL
      FROM user_trips ut
      WHERE ut.id = uj.trip_id AND ut.user_id <> uj.user_id
      RETURNING uj.id, uj.user_id, ut.id AS trip_id, ut.user_id AS trip_user_id
    `);
    if (unfiled.rows.length > 0) {
      console.log(`Unfiled ${unfiled.rows.length} journey(s) from another user's trip:`);
      for (const row of unfiled.rows) {
        console.log(
          `  journey ${row.id} (user ${row.user_id}) from trip ${row.trip_id} (user ${row.trip_user_id})`,
        );
      }
      console.log();
    }

    console.log("Constraints:");
    await addConstraint(client, "user_trips", "user_trips_id_user_id_key", "UNIQUE (id, user_id)");
    await addConstraint(
      client,
      "user_journeys",
      "user_journeys_id_user_id_key",
      "UNIQUE (id, user_id)",
    );
    await addConstraint(
      client,
      "user_journeys",
      "user_journeys_trip_owner_fkey",
      "FOREIGN KEY (trip_id, user_id) REFERENCES user_trips (id, user_id) ON DELETE SET NULL (trip_id)",
    );
    await addConstraint(
      client,
      "user_logged_parts",
      "user_logged_parts_journey_owner_fkey",
      "FOREIGN KEY (journey_id, user_id) REFERENCES user_journeys (id, user_id) ON DELETE CASCADE",
    );

    // The single-column FKs the composite ones replace (Postgres' default names).
    await client.query(
      "ALTER TABLE user_journeys DROP CONSTRAINT IF EXISTS user_journeys_trip_id_fkey",
    );
    await client.query(
      "ALTER TABLE user_logged_parts DROP CONSTRAINT IF EXISTS user_logged_parts_journey_id_fkey",
    );
    console.log("  - single-column trip_id / journey_id foreign keys");

    await client.query("COMMIT");

    console.log("\n=====================================");
    console.log("Ownership constraints in place!");
    console.log("=====================================\n");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error adding ownership constraints:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
addOwnershipConstraints().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
