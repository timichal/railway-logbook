#!/usr/bin/env tsx
/**
 * List the routes that backtrack unintentionally, each with an OpenRailwayMap
 * link to where they double back. Same set as the admin routes list's
 * "Unintended backtracking" filter: `has_backtracking` set,
 * `intended_backtracking` not.
 *
 * The flag says a route turns back on itself somewhere along its length, but not
 * where — that is all the recalculation stores. So this re-runs the same
 * coordinate-based search `verifyRouteData` does, for the flagged routes only,
 * and reports the connection the pathfinder tripped on:
 *
 *   [42] Brno → Praha https://openrailwaymap.app/#view=18/49.19412/16.61234 (way 68490904, 152°)
 *
 * The link centres OpenRailwayMap on the V's vertex, where the track layout that
 * makes the route double back is what you need to look at. Its hash carries a
 * position and nothing else — there is no way to select an OSM object from the
 * URL — so the way the route turns back onto is printed alongside it, for
 * pasting into JOSM or openstreetmap.org/way/<id>.
 *
 * Nothing is written — the flags stay as `verifyRouteData` left them.
 *
 * Usage: npm run showBacktracking [--concurrency=N]
 *        --concurrency  routes searched at once (default as for recalculation)
 */
import dotenv from "dotenv";
import type { Pool } from "pg";
import { RailwayPathFinder } from "./lib/railwayPathFinder";
import { createRecalcPool, parseConcurrencyArg } from "./verifyRouteData";

dotenv.config();

interface RouteRow {
  track_id: number;
  from_station: string;
  to_station: string;
  is_valid: boolean | null;
  start_lng: string;
  start_lat: string;
  end_lng: string;
  end_lat: string;
}

/** What the search made of one flagged route. */
type Outcome =
  | { status: "backtracks"; url: string; partId: string; angleDegrees: number }
  | { status: "clean" }
  | { status: "unresolved"; reason: string };

/**
 * OpenRailwayMap (the vector app), centred on the offending vertex.
 *
 * `#view=<zoom>/<lat>/<lon>`, the app's own permalink shape. `style` and `date`
 * are the hash's other parameters and are left off: the app omits them itself
 * when they are at their defaults.
 */
function openRailwayMapUrl([lng, lat]: [number, number]): string {
  return `https://openrailwaymap.app/#view=18/${lat.toFixed(5)}/${lng.toFixed(5)}`;
}

async function locateBacktracking(db: Pool, route: RouteRow): Promise<Outcome> {
  // Quiet for the same reason the bulk recalculation is: several searches run at
  // once and their per-route chatter would bury the list.
  const pathFinder = new RailwayPathFinder({ quiet: true });

  try {
    const result = await pathFinder.findPathFromCoordinates(
      db,
      [parseFloat(route.start_lng), parseFloat(route.start_lat)],
      [parseFloat(route.end_lng), parseFloat(route.end_lat)],
    );

    if (!result) return { status: "unresolved", reason: "no path found" };
    if (!result.backtrackingAt) return { status: "clean" };

    const { toPartId, coordinate, angleDegrees } = result.backtrackingAt;
    return {
      status: "backtracks",
      url: openRailwayMapUrl(coordinate),
      partId: toPartId,
      angleDegrees,
    };
  } catch (error) {
    return {
      status: "unresolved",
      reason: error instanceof Error ? error.message : "unknown error during search",
    };
  }
}

async function showBacktracking(): Promise<void> {
  const concurrency = parseConcurrencyArg(process.argv.slice(2));
  const pool = createRecalcPool(concurrency);

  try {
    // Not scoped to a region: every route with the flag is worth seeing, and the
    // list carries country-bearing station names anyway.
    const routes = await pool.query<RouteRow>(`
      SELECT
        track_id,
        from_station,
        to_station,
        is_valid,
        ST_X(starting_coordinate) as start_lng,
        ST_Y(starting_coordinate) as start_lat,
        ST_X(ending_coordinate) as end_lng,
        ST_Y(ending_coordinate) as end_lat
      FROM railway_routes
      WHERE has_backtracking = TRUE
        AND intended_backtracking IS NOT TRUE
        AND starting_coordinate IS NOT NULL
        AND ending_coordinate IS NOT NULL
      ORDER BY from_station, to_station, track_id
    `);

    if (routes.rows.length === 0) {
      console.log("No routes are flagged as backtracking unintentionally.");
      return;
    }

    // Outcomes by index, so the list reads in query order however the workers
    // happen to interleave.
    const outcomes: Outcome[] = new Array(routes.rows.length);
    let nextIndex = 0;
    let searched = 0;

    process.stderr.write(
      `Locating backtracking in ${routes.rows.length} route(s), ${concurrency} at a time...\n`,
    );

    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex++;
        if (index >= routes.rows.length) return;

        outcomes[index] = await locateBacktracking(pool, routes.rows[index]);

        searched++;
        process.stderr.write(`\r  ${searched}/${routes.rows.length} routes searched...`);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, routes.rows.length) }, () => worker()),
    );
    process.stderr.write("\n\n");

    const clean: RouteRow[] = [];
    const unresolved: Array<{ route: RouteRow; reason: string }> = [];

    for (const [index, route] of routes.rows.entries()) {
      const outcome = outcomes[index];
      const label = `[${route.track_id}] ${route.from_station} → ${route.to_station}`;

      if (outcome.status === "backtracks") {
        console.log(
          `${label} ${outcome.url} (way ${outcome.partId}, ${outcome.angleDegrees.toFixed(0)}°)`,
        );
      } else if (outcome.status === "clean") {
        clean.push(route);
      } else {
        unresolved.push({ route, reason: outcome.reason });
      }
    }

    // The two sections below account for the flagged routes that produced no
    // link, so the list can be read as complete.

    // A flag set by the last recalculation, against OSM data that has since
    // moved on: worth reporting, since the next recalculation will clear it.
    if (clean.length > 0) {
      console.log("");
      console.log(`=== No longer backtracking (${clean.length}, flag is stale) ===`);
      for (const route of clean) {
        console.log(`  [${route.track_id}] ${route.from_station} → ${route.to_station}`);
      }
    }

    if (unresolved.length > 0) {
      console.log("");
      console.log(`=== Could not be searched (${unresolved.length}) ===`);
      for (const { route, reason } of unresolved) {
        // A route already marked invalid can't be searched and isn't news: its
        // backtracking flag is left over from whenever it last recalculated.
        const invalid = route.is_valid === false ? " (route is marked invalid)" : "";
        console.log(
          `  [${route.track_id}] ${route.from_station} → ${route.to_station}: ${reason}${invalid}`,
        );
      }
    }
  } catch (error) {
    console.error("Error listing backtracking routes:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

showBacktracking().catch(console.error);
