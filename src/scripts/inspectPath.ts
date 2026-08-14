#!/usr/bin/env tsx
/**
 * Debug the journey planner from the command line: runs the same pathfinder the
 * Journey Planner tab uses and prints the resulting chain, the gap left between
 * each consecutive pair of routes, and how long the search took.
 *
 * A gap means the two routes' endpoints don't coincide. A few tens of metres is
 * normal (endpoints are hand-picked click points); a few hundred means the path
 * probably skipped a short connecting route.
 *
 * Usage: npm run inspectPath -- "Waren (Müritz)" "Rostock Hauptbahnhof" [via...]
 *        Arguments are station names (exact, or a unique prefix) or station ids.
 */
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: npm run inspectPath -- "<from>" "<to>" ["<via>"...]');
    process.exit(1);
  }

  const { findRoutePathBetweenStations } = await import("../lib/routePathFinder");
  const pool = (await import("../lib/db")).default;
  const { haversineDistance } = await import("../lib/geoUtils");

  const resolve = async (arg: string): Promise<number> => {
    // A numeric argument is taken as a station id verbatim — the way to inspect a
    // station the name search below won't return.
    if (/^\d+$/.test(arg)) return Number(arg);

    // Only near_route stations, matching what the planner's autocomplete offers
    const { rows } = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM stations WHERE near_route AND (name = $1 OR name ILIKE $1 || '%') ORDER BY length(name), id LIMIT 5`,
      [arg],
    );
    if (rows.length === 0) throw new Error(`No station matching "${arg}"`);
    if (rows.length > 1 && rows[0].name !== arg) {
      const others = rows.slice(1).map((r) => r.name);
      console.log(`"${arg}" -> ${rows[0].name} (also matched: ${others.join(", ")})`);
    }
    return Number(rows[0].id);
  };

  const [from, to, ...via] = await Promise.all(args.map(resolve));

  const started = performance.now();
  const res = await findRoutePathBetweenStations(from, to, via);
  const elapsed = performance.now() - started;
  console.log(`search took ${elapsed.toFixed(0)} ms`);

  if (res.error) {
    console.log("ERROR:", res.error);
    await pool.end();
    return;
  }

  const geom = await pool.query<{
    track_id: number;
    sx: number;
    sy: number;
    ex: number;
    ey: number;
  }>(
    `SELECT track_id,
       ST_X(ST_PointN(geometry, 1)) sx, ST_Y(ST_PointN(geometry, 1)) sy,
       ST_X(ST_PointN(geometry, ST_NPoints(geometry))) ex, ST_Y(ST_PointN(geometry, ST_NPoints(geometry))) ey
     FROM railway_routes WHERE track_id = ANY($1)`,
    [res.routes.map((r) => r.track_id)],
  );
  const ends = new Map(
    geom.rows.map((r) => [
      r.track_id,
      { s: [r.sx, r.sy] as [number, number], e: [r.ex, r.ey] as [number, number] },
    ]),
  );

  let worstGap = 0;
  for (let i = 0; i < res.routes.length; i++) {
    const route = res.routes[i];
    const partial = route.partial
      ? `  [partial: ${route.travelled_length_km.toFixed(2)} km of ${route.length_km.toFixed(2)}]`
      : "";
    console.log(
      `  ${String(route.track_id).padStart(5)}  ${route.travelled_length_km.toFixed(2).padStart(7)} km  ${route.from_station} <-> ${route.to_station}${partial}`,
    );

    const a = ends.get(route.track_id);
    const b = i + 1 < res.routes.length ? ends.get(res.routes[i + 1].track_id) : undefined;
    if (!a || !b) continue;

    const gap = Math.min(
      haversineDistance(a.s, b.s),
      haversineDistance(a.s, b.e),
      haversineDistance(a.e, b.s),
      haversineDistance(a.e, b.e),
    );
    worstGap = Math.max(worstGap, gap);
    if (gap > 5) console.log(`         ^ gap of ${gap.toFixed(1)} m`);
  }

  console.log(
    `  total ${res.totalDistance.toFixed(1)} km over ${res.routes.length} routes, worst gap ${worstGap.toFixed(1)} m`,
  );
  await pool.end();
}

main();
