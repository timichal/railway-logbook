"use server";

/**
 * The web app's public route and station reads, as server actions. None needs a
 * session; the signed-in user's own reads are the `api/me` route handlers
 * (`sessionReads.ts`).
 *
 * Each delegates to a plain module (`routeQueries.ts`, `progressQueries.ts`),
 * which the mobile API's route handlers call too (MOBILE_APP_PLAN.md, Phase 1).
 */

import { buildCoveredStretches, normalizeCoveredRanges } from "./progressQueries";
import { assertRegionId } from "./regionArgument";
import {
  lineGeometryByName,
  routeBoundsByIds,
  routeMetadataByIds,
  routeSummariesInRegion,
  searchMapByName,
  searchStationsByName,
  trackIdsInRegion,
} from "./routeQueries";
import type { RegionId } from "./shared/regions";
import type {
  CoveredRange,
  CoveredStretch,
  LineGeometry,
  MapSearchResults,
  RailwayRoute,
  RouteBounds,
  RouteSummary,
  Station,
} from "./shared/types";

/** Station name search for the map search box and the Journey Planner. */
export async function searchStations(searchQuery: string, region: RegionId): Promise<Station[]> {
  assertRegionId(region);
  return searchStationsByName(searchQuery, region);
}

/**
 * The map search box: near-route stations, and line names where the region names
 * its lines. No authentication required — route data is public.
 */
export async function searchMap(searchQuery: string, region: RegionId): Promise<MapSearchResults> {
  assertRegionId(region);
  return searchMapByName(searchQuery, region);
}

/**
 * A line picked in the map search box, as the geometry its highlight is drawn from.
 * No authentication required — route data is public.
 */
export async function getLineGeometry(name: string, region: RegionId): Promise<LineGeometry[]> {
  assertRegionId(region);
  return lineGeometryByName(name, region);
}

/** The track ids of every route in a region. */
export async function getRegionTrackIds(region: RegionId): Promise<number[]> {
  assertRegionId(region);
  return trackIdsInRegion(region);
}

/** Every route in a region, without geometry (see RouteSummary). No authentication required. */
export async function getRouteSummaries(region: RegionId): Promise<RouteSummary[]> {
  assertRegionId(region);
  return routeSummariesInRegion(region);
}

/** Metadata for a set of routes. No authentication required — route data is public. */
export async function getRoutesByIds(trackIds: number[]): Promise<RailwayRoute[]> {
  return routeMetadataByIds(trackIds);
}

/**
 * The bounding box of a set of routes in a region (see routeBoundsByIds). Public, as
 * route geometry is. For the local journeys, which hold only track ids; the
 * journey, trip and planner actions return their bounds with their result.
 */
export async function getRoutesBounds(
  trackIds: number[],
  region: RegionId,
): Promise<RouteBounds | null> {
  assertRegionId(region);
  return routeBoundsByIds(trackIds, region);
}

/**
 * The ridden stretches, as `api/me/coverage` draws them, for ranges the caller
 * holds itself — the localStorage journeys of a user who isn't logged in. Route geometry is public
 * (it is served as tiles to everyone), so this needs no authentication; the
 * ranges are validated and capped instead.
 */
export async function getCoveredStretchesFor(ranges: CoveredRange[]): Promise<CoveredStretch[]> {
  return buildCoveredStretches(normalizeCoveredRanges(ranges));
}
