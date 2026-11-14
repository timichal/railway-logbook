/**
 * The web page's public route and station reads, from the `api/public` route
 * handlers rather than from server actions: Next runs a client's actions one at a
 * time, so as actions a search typed while the Journey Planner searched waited
 * for the planner. None needs a session. A refusal is thrown as an `ActionError`
 * (`fetchJson.ts`).
 */

import { fetchJson, postJson, queryString } from "./fetchJson";
import type { RegionId } from "./shared/regions";
import type {
  CoveredRange,
  CoveredStretch,
  LineGeometry,
  MapSearchResults,
  RailwayRoute,
  RouteBounds,
  Station,
} from "./shared/types";

const getPublic = <T>(path: string, params: Record<string, string>): Promise<T> =>
  fetchJson<T>(`/api/public/${path}?${queryString(params)}`);

/** Station name search for the Journey Planner's station fields. */
export function searchStations(q: string, region: RegionId): Promise<Station[]> {
  return getPublic("stations", { q, region });
}

/** The map search box: near-route stations, and lines where the region names them. */
export function searchMap(q: string, region: RegionId): Promise<MapSearchResults> {
  return getPublic("search", { q, region });
}

/** A line picked in the map search box, as the geometry its highlight is drawn from. */
export function getLineGeometry(name: string, region: RegionId): Promise<LineGeometry[]> {
  return getPublic("line-geometry", { name, region });
}

/** The track ids of every route in a region. */
export function getRegionTrackIds(region: RegionId): Promise<number[]> {
  return getPublic("track-ids", { region });
}

/** Metadata for a set of routes. */
export function getRoutesByIds(trackIds: number[]): Promise<RailwayRoute[]> {
  if (trackIds.length === 0) return Promise.resolve([]);
  return postJson("/api/public/routes", { trackIds });
}

/**
 * The bounding box of a set of routes in a region (see routeBoundsByIds), for the
 * local journeys, which hold only track ids; the journey, trip and planner reads
 * return their bounds with their result.
 */
export function getRoutesBounds(trackIds: number[], region: RegionId): Promise<RouteBounds | null> {
  if (trackIds.length === 0) return Promise.resolve(null);
  return postJson(`/api/public/routes/bounds?${queryString({ region })}`, { trackIds });
}

/** The ridden stretches for ranges the caller holds itself (the localStorage journeys). */
export function getCoveredStretchesFor(ranges: CoveredRange[]): Promise<CoveredStretch[]> {
  if (ranges.length === 0) return Promise.resolve([]);
  return postJson("/api/public/stretches", { ranges });
}
