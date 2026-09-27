#!/usr/bin/env tsx
/**
 * Bring an existing database up to the tightened schema
 *
 * `database/init/01-schema.sql` now carries constraints an older database lacks:
 *
 * - NOT NULL on `user_logged_parts.track_id` and `.partial`, and on the
 *   railway_routes flags (`is_valid`, `scenic`, `under_repair`,
 *   `intended_backtracking`, `has_backtracking`), `frequency`, `line_class`,
 *   `geometry`, `length_km` and both click coordinates. A NULL `length_km` made
 *   a route free in the journey planner; a NULL `partial` was neither whole nor
 *   partial to `user_fully_ridden_routes`.
 * - CHECKs on `usage_type IN (0, 1, 2)`, on the route country codes and on every
 *   element of `user_preferences.selected_countries` (two upper-case letters),
 *   and `users.email = lower(btrim(email))`, which makes the existing UNIQUE
 *   case-insensitive.
 * - A `railway_routes_update_timestamp` trigger, as the other tables have.
 *
 * and drops what nothing uses: the deprecated `starting_part_id`/`ending_part_id`
 * columns (with their indexes), and four indexes that are each the prefix of
 * another. It then re-applies `02-vector-tiles.sql`, whose route tile no longer
 * names the dropped columns.
 *
 * Before tightening it repairs what the constraints would reject where the
 * repair is unambiguous — a NULL flag takes its column default, a missing length
 * is measured off the geometry, codes and emails are trimmed and case-folded, a
 * logged part of no route is deleted (every query already skipped it). What has
 * no obvious answer (a route with no geometry, an unknown usage type, two
 * accounts whose emails differ only in case) is listed and the run stops.
 *
 * Run it after the code that stops writing the dropped columns is deployed. One
 * transaction, and safe to rerun.
 *
 * **Backups taken before it cannot be restored after it.** serverData's dumps are
 * data-only, so an older one still COPYs into the two dropped columns, and may
 * carry rows the new constraints reject; `restoreRouteData` of it fails (and
 * rolls back, leaving the data as it was). Take a fresh `backupRouteData` once
 * the server is migrated. Pulls from an unmigrated server fail the same way, so
 * migrate the server before the local database.
 *
 * When this script is removed, authQueries.ts' email lookups can drop the
 * `lower(email)` they carry for the gap between deploy and migration.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";
import { Pool, type PoolClient } from "pg";
import { getDbConfig } from "../lib/dbConfig";

// Load environment variables from .env file
dotenv.config();

// Create pool after loading environment variables
const dbConfig = getDbConfig();
const pool = new Pool(dbConfig);

const COUNTRY_CODE_SQL = "'^[A-Z]{2}$'";

/**
 * Every element of selected_countries is a country code. A NULL element is
 * joined as '?' so it fails the pattern instead of vanishing from the string.
 * The same expression is the CHECK in 01-schema.sql; the repair step below
 * selects the rows it rejects, so the two cannot drift apart.
 */
const SELECTED_COUNTRIES_VALID_SQL =
  "array_to_string(selected_countries, ',', '?') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'";

/** Lists the rows a check found and stops the run, or does nothing if there are none. */
function failIfAny(rows: Record<string, unknown>[], what: string) {
  if (rows.length === 0) return;
  console.error(`${what}:`);
  for (const row of rows) console.error(`  ${JSON.stringify(row)}`);
  throw new Error(`${rows.length} row(s) need resolving by hand`);
}

function reportFixed(count: number | null, what: string) {
  if (count) console.log(`  ~ ${what}: ${count}`);
}

async function addConstraint(client: PoolClient, table: string, name: string, definition: string) {
  const exists = await client.query("SELECT 1 FROM pg_constraint WHERE conname = $1", [name]);
  if (exists.rows.length > 0) {
    console.log(`  = ${table}.${name} already present`);
    return;
  }
  await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition}`);
  console.log(`  + ${table}.${name}`);
}

async function repairData(client: PoolClient) {
  console.log("Repairs:");

  const unrouted = await client.query("DELETE FROM user_logged_parts WHERE track_id IS NULL");
  reportFixed(unrouted.rowCount, "logged parts with no route, deleted");

  const nullPartial = await client.query(
    "UPDATE user_logged_parts SET partial = FALSE WHERE partial IS NULL",
  );
  reportFixed(nullPartial.rowCount, "logged parts with a NULL partial, set to whole");

  const nullFlags = await client.query(`
    UPDATE railway_routes SET
      is_valid = COALESCE(is_valid, TRUE),
      scenic = COALESCE(scenic, FALSE),
      under_repair = COALESCE(under_repair, FALSE),
      intended_backtracking = COALESCE(intended_backtracking, FALSE),
      has_backtracking = COALESCE(has_backtracking, FALSE),
      frequency = COALESCE(frequency, ARRAY[]::TEXT[]),
      line_class = COALESCE(line_class, 'branch')
    WHERE is_valid IS NULL OR scenic IS NULL OR under_repair IS NULL
       OR intended_backtracking IS NULL OR has_backtracking IS NULL
       OR frequency IS NULL OR line_class IS NULL
  `);
  reportFixed(nullFlags.rowCount, "routes with a NULL flag, set to its default");

  const missingGeometry = await client.query(`
    SELECT track_id, from_station, to_station
    FROM railway_routes
    WHERE geometry IS NULL OR starting_coordinate IS NULL OR ending_coordinate IS NULL
    ORDER BY track_id
  `);
  failIfAny(missingGeometry.rows, "Routes missing their geometry or a click coordinate");

  const nullLength = await client.query(`
    UPDATE railway_routes SET length_km = ST_Length(geometry::geography) / 1000
    WHERE length_km IS NULL
  `);
  reportFixed(nullLength.rowCount, "routes with no length, measured");

  const badUsage = await client.query(`
    SELECT track_id, from_station, to_station, usage_type
    FROM railway_routes WHERE usage_type NOT IN (0, 1, 2)
    ORDER BY track_id
  `);
  failIfAny(badUsage.rows, "Routes with an unknown usage_type");

  const countryCase = await client.query(`
    UPDATE railway_routes SET
      start_country = NULLIF(upper(btrim(start_country)), ''),
      end_country = NULLIF(upper(btrim(end_country)), '')
    WHERE start_country IS DISTINCT FROM NULLIF(upper(btrim(start_country)), '')
       OR end_country IS DISTINCT FROM NULLIF(upper(btrim(end_country)), '')
  `);
  reportFixed(countryCase.rowCount, "routes with a country code not in upper case");

  const badCountry = await client.query(`
    SELECT track_id, from_station, to_station, start_country, end_country
    FROM railway_routes
    WHERE start_country !~ ${COUNTRY_CODE_SQL} OR end_country !~ ${COUNTRY_CODE_SQL}
    ORDER BY track_id
  `);
  failIfAny(badCountry.rows, "Routes with a malformed country code");

  // normalizeCountryCodes in SQL: trim, upper-case, keep the well-formed ones,
  // first occurrence wins, order kept
  const selected = await client.query(`
    UPDATE user_preferences SET selected_countries = ARRAY(
      SELECT code FROM (
        SELECT upper(btrim(raw)) AS code, min(ord) AS first
        FROM unnest(selected_countries) WITH ORDINALITY AS u(raw, ord)
        WHERE upper(btrim(raw)) ~ ${COUNTRY_CODE_SQL}
        GROUP BY 1
      ) codes
      ORDER BY first
    )
    WHERE NOT (${SELECTED_COUNTRIES_VALID_SQL})
  `);
  reportFixed(selected.rowCount, "country filters with a malformed code, normalized");

  const emailClashes = await client.query(`
    SELECT lower(btrim(email)) AS email, array_agg(id ORDER BY id) AS user_ids
    FROM users
    GROUP BY 1
    HAVING count(*) > 1
  `);
  failIfAny(emailClashes.rows, "Accounts whose emails differ only in case or spacing");

  const emails = await client.query(`
    UPDATE users SET email = lower(btrim(email)) WHERE email <> lower(btrim(email))
  `);
  reportFixed(emails.rowCount, "emails trimmed and lower-cased");

  console.log();
}

async function applySchemaConstraints() {
  const client = await pool.connect();

  try {
    console.log("Applying schema constraints...");
    console.log("=====================================\n");

    await client.query("BEGIN");

    await repairData(client);

    console.log("NOT NULL:");
    const notNull: Record<string, string[]> = {
      user_logged_parts: ["track_id", "partial"],
      railway_routes: [
        "frequency",
        "scenic",
        "line_class",
        "geometry",
        "length_km",
        "starting_coordinate",
        "ending_coordinate",
        "is_valid",
        "under_repair",
        "intended_backtracking",
        "has_backtracking",
      ],
    };
    for (const [table, columns] of Object.entries(notNull)) {
      await client.query(
        `ALTER TABLE ${table} ${columns.map((column) => `ALTER COLUMN ${column} SET NOT NULL`).join(", ")}`,
      );
      console.log(`  ${table}: ${columns.join(", ")}`);
    }

    // Named as Postgres names the column CHECKs 01-schema.sql declares inline,
    // so a migrated database and a fresh one carry the same constraint names
    console.log("\nChecks:");
    await addConstraint(
      client,
      "railway_routes",
      "railway_routes_usage_type_check",
      "CHECK (usage_type IN (0, 1, 2))",
    );
    await addConstraint(
      client,
      "railway_routes",
      "railway_routes_start_country_check",
      `CHECK (start_country ~ ${COUNTRY_CODE_SQL})`,
    );
    await addConstraint(
      client,
      "railway_routes",
      "railway_routes_end_country_check",
      `CHECK (end_country ~ ${COUNTRY_CODE_SQL})`,
    );
    await addConstraint(
      client,
      "user_preferences",
      "user_preferences_selected_countries_format",
      `CHECK (${SELECTED_COUNTRIES_VALID_SQL})`,
    );
    await addConstraint(
      client,
      "users",
      "users_email_check",
      "CHECK (email = lower(btrim(email)))",
    );

    console.log("\nDropped:");
    for (const index of [
      "idx_logged_parts_user_id",
      "idx_logged_parts_journey_id",
      "idx_user_journeys_user_id",
      "idx_user_journeys_date",
      "idx_railway_routes_starting_part",
      "idx_railway_routes_ending_part",
    ]) {
      await client.query(`DROP INDEX IF EXISTS ${index}`);
    }
    console.log("  - redundant and dead indexes");
    await client.query(
      "ALTER TABLE railway_routes DROP COLUMN IF EXISTS starting_part_id, DROP COLUMN IF EXISTS ending_part_id",
    );
    console.log("  - railway_routes.starting_part_id / ending_part_id");

    await client.query(`
      CREATE OR REPLACE TRIGGER railway_routes_update_timestamp
      BEFORE UPDATE ON railway_routes
      FOR EACH ROW
      EXECUTE FUNCTION update_timestamp()
    `);
    console.log("\nTrigger:\n  + railway_routes_update_timestamp");

    // The route tile function selected the dropped columns: a plpgsql body is
    // only checked when it runs, so without this every route tile would fail
    const vectorTilesSql = readFileSync(
      join(process.cwd(), "database", "init", "02-vector-tiles.sql"),
      "utf-8",
    );
    await client.query(vectorTilesSql);
    console.log("\nRe-applied 02-vector-tiles.sql");

    await client.query("COMMIT");

    console.log("\n=====================================");
    console.log("Schema constraints in place!");
    console.log("=====================================\n");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error applying schema constraints:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run script
applySchemaConstraints().catch((error) => {
  console.error("Script error:", error);
  process.exit(1);
});
