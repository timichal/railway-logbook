/**
 * Journey-planner pathfinding over whole routes. See "Journey planner
 * pathfinding" in CLAUDE.md for the search itself.
 *
 * This module is the flow — find the stations' routes, search each segment,
 * work out what was travelled — and the reads that turn the plan into
 * `PlannerRoute`s. The pieces are under `planner/`: the network model
 * (`routeGraph.ts`) and its cache (`routeGraphCache.ts`), the search
 * (`routeSearch.ts`), the stations' routes (`stations.ts`) and the travelled
 * stretches (`routeVisits.ts`). The search and the stretches are pure.
 *
 * A plain module rather than a "use server" one: the web app reaches it through
 * `plannerActions.ts`, the mobile API through its own route handler, and
 * `inspectPath.ts` imports it straight from the CLI (MOBILE_APP_PLAN.md,
 * Phase 1). Nothing here touches a cookie or a request.
 */

import pool from "./db";
import { getRouteNetwork } from "./planner/routeGraphCache";
import {
  changeCosts,
  type SearchResult,
  searchSegment,
  type TerminalFractions,
} from "./planner/routeSearch";
import { planTrims, planVisits, type TrimSpec } from "./planner/routeVisits";
import { findRoutesNearStations } from "./planner/stations";
import { MAX_VIA_STATIONS } from "./shared/constants";
import type { PartialRouteGeometry, PlannerRoute } from "./shared/types";

export interface PathResult {
  routes: PlannerRoute[];
  totalDistance: number;
  error?: string;
}

/**
 * Get route details for a list of route IDs
 */
async function getRouteDetails(routeIds: number[]): Promise<PlannerRoute[]> {
  if (routeIds.length === 0) return [];

  const client = await pool.connect();
  try {
    const result = await client.query<{
      track_id: number;
      from_station: string;
      to_station: string;
      description: string;
      length_km: string | number;
    }>(
      `
      SELECT track_id, from_station, to_station, description, length_km
      FROM railway_routes
      WHERE track_id = ANY($1)
      ORDER BY array_position($1, track_id)
      `,
      [routeIds],
    );
    // Convert length_km to number (PostgreSQL returns it as string)
    return result.rows.map((row) => {
      const lengthKm =
        typeof row.length_km === "string" ? parseFloat(row.length_km) : row.length_km;
      return {
        track_id: row.track_id,
        from_station: row.from_station,
        to_station: row.to_station,
        description: row.description,
        length_km: lengthKm,
        travelled_length_km: lengthKm,
      };
    });
  } finally {
    client.release();
  }
}

/**
 * Cut each route down to the fraction range `planTrims` picked, with the length
 * of what is left, by track id.
 */
async function cutTravelledStretches(
  trims: TrimSpec[],
): Promise<Map<number, { geometry: PartialRouteGeometry; lengthKm: number }>> {
  const cut = new Map<number, { geometry: PartialRouteGeometry; lengthKm: number }>();
  if (trims.length === 0) return cut;

  const result = await pool.query<{
    track_id: number;
    lo: number;
    hi: number;
    geojson: string;
    length_km: number;
  }>(
    `
    SELECT
      t.track_id,
      t.lo,
      t.hi,
      ST_AsGeoJSON(ST_LineSubstring(r.geometry, t.lo, t.hi)) AS geojson,
      ST_Length(ST_LineSubstring(r.geometry, t.lo, t.hi)::geography) / 1000 AS length_km
    FROM unnest($1::int[], $2::float8[], $3::float8[]) AS t(track_id, lo, hi)
    JOIN railway_routes r ON r.track_id = t.track_id
    `,
    [trims.map((s) => s.trackId), trims.map((s) => s.lo), trims.map((s) => s.hi)],
  );

  for (const row of result.rows) {
    const parsed = JSON.parse(row.geojson) as { coordinates: [number, number][] };
    if (!parsed.coordinates || parsed.coordinates.length < 2) continue;
    cut.set(row.track_id, {
      geometry: {
        track_id: row.track_id,
        // The fractions travel with the geometry: they are what gets stored when
        // the route is logged, so the stretch survives an OSM recalculation
        covered_start: Number(row.lo),
        covered_end: Number(row.hi),
        coordinates: parsed.coordinates,
      },
      lengthKm: Number(row.length_km),
    });
  }

  return cut;
}

/**
 * Find the shortest path of routes connecting from -> via -> to stations
 */
export async function findRoutePathBetweenStations(
  fromStationId: number,
  toStationId: number,
  viaStationIds: number[] = [],
): Promise<PathResult> {
  // Refused here rather than in each caller, so the cap holds for the web action,
  // the HTTP handler and the CLI alike (see MAX_VIA_STATIONS)
  if (viaStationIds.length > MAX_VIA_STATIONS) {
    return {
      routes: [],
      totalDistance: 0,
      error: `A journey may have at most ${MAX_VIA_STATIONS} via stations`,
    };
  }

  // Normalized because station ids are bigint-backed: pg hands them back as
  // strings, and they are used as map keys below
  const stationSequence = [fromStationId, ...viaStationIds, toStationId].map(Number);

  // A leg from a station to itself has no stretch to cover: the direct finish
  // costs 0 and the plan would be a zero-width trim, which says nothing useful
  // (see planTrims). A loop (A via B to A) is fine — only consecutive stops are
  // refused.
  if (stationSequence.some((id, i) => i > 0 && id === stationSequence[i - 1])) {
    return {
      routes: [],
      totalDistance: 0,
      error: "Consecutive stops must be different stations",
    };
  }

  try {
    const [stations, network] = await Promise.all([
      findRoutesNearStations([...new Set(stationSequence)]),
      getRouteNetwork(),
    ]);

    // Every id in the sequence was asked about, so each has an entry
    const stops = stationSequence.map((id) => stations.get(id)!);

    // Validate we found routes near all stations
    if (stops[0].routes.length === 0) {
      return { routes: [], totalDistance: 0, error: "No routes found near starting station" };
    }
    if (stops[stops.length - 1].routes.length === 0) {
      return { routes: [], totalDistance: 0, error: "No routes found near ending station" };
    }
    for (let i = 1; i < stops.length - 1; i++) {
      if (stops[i].routes.length === 0) {
        return { routes: [], totalDistance: 0, error: `No routes found near via station ${i}` };
      }
    }

    // Find path sequentially between each pair of stations. A segment after a
    // via is seeded from every route serving the via, not only the one the
    // previous segment arrived on: where two lines cross mid-route, pinning the
    // second segment to the arriving line forced it out through an endpoint —
    // a detour, or no path at all — although the other line serves the via
    // directly. Carrying on along the arriving line is still one of the seeds,
    // and `planVisits` merges the two visits back into one when it is taken;
    // changing to another costs what `changeCosts` says.
    const segments: SearchResult[] = [];

    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i];
      const to = stops[i + 1];
      const previous = segments[segments.length - 1];
      const startCosts = previous
        ? changeCosts(previous.path[previous.path.length - 1], from.routes, from.points)
        : undefined;

      // Each segment is costed from its own pair of stations, so a via station
      // partway along a route splits that route's cost between the two segments
      const fractions: TerminalFractions = { from: from.fractions, to: to.fractions };

      const segment = searchSegment(network, from.routes, to.routes, fractions, startCosts);
      if (!segment) {
        return {
          routes: [],
          totalDistance: 0,
          error: `No path found for segment ${i + 1}. The stations might not be connected by regular-service routes. Try adding via stations to break up the journey.`,
        };
      }

      segments.push(segment);
    }

    const visits = planVisits(segments, stationSequence, stations);
    const { trims, untravelled } = planTrims(visits, network.routeInfo);

    // Get route details, then cut each route down to the stretch travelled
    const [pathRoutes, stretches] = await Promise.all([
      getRouteDetails(visits.map((visit) => visit.trackId)),
      cutTravelledStretches(trims),
    ]);

    // A route the journey barely enters is not part of it
    const routes = pathRoutes.filter((route) => !untravelled.has(route.track_id));
    if (routes.length === 0) {
      return {
        routes: [],
        totalDistance: 0,
        error: "These stations are too close together on the line to log any track between them",
      };
    }

    for (const route of routes) {
      const stretch = stretches.get(route.track_id);
      if (!stretch) continue;
      route.partial = stretch.geometry;
      route.travelled_length_km = stretch.lengthKm;
    }

    const totalDistance = routes.reduce((sum, r) => sum + r.travelled_length_km, 0);

    return { routes, totalDistance };
  } catch (error) {
    console.error("Error finding route path:", error);
    return {
      routes: [],
      totalDistance: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
