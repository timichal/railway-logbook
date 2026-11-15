/**
 * The web page's public route and station reads, from the `api/public` route
 * handlers rather than from server actions: Next runs a client's actions one at a
 * time, so as actions a search typed while the Journey Planner searched waited
 * for the planner. None needs a session. A refusal is thrown as an `ActionError`
 * (`fetchJson.ts`).
 */

import { fetchJson, listParam, postJson, queryString } from "./fetchJson";
import type { ProgressByCountry, UserProgress } from "./shared/progress";
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

const getPublic = <T>(path: string, params: Record<string, string | undefined>): Promise<T> =>
  fetchJson<T>(`/api/public/${path}?${queryString(params)}`);

/**
 * The route tile's current version (`routesTileVersion`), for a page whose own
 * may have gone stale: restored from the history, or left open across a route
 * save (`useRoutesTileVersion`). Never cached.
 */
export async function getRoutesTileVersion(): Promise<string> {
  const { version } = await fetchJson<{ version: string }>("/api/public/routes-tile-version", {
    cache: "no-store",
  });
  return version;
}

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

/**
 * Every route in a region without geometry, for a logged-out visitor's progress
 * and colouring. The browser keeps it between loads (`routesCachedJson`).
 */
export function getRouteSummaries(region: RegionId): Promise<RouteSummary[]> {
  return getPublic("route-summaries", { region });
}

/**
 * The network's totals with nothing ridden, for a logged-out visitor with an
 * empty local log, who then needn't load the route summaries. `selectedCountries`
 * and `shownUsageTypes` keep their three states, as `fetchProgress`.
 */
export function getNetworkProgress(
  region: RegionId,
  selectedCountries?: string[],
  shownUsageTypes?: readonly number[],
): Promise<UserProgress> {
  return getPublic("progress", {
    region,
    countries: listParam(selectedCountries),
    usage: listParam(shownUsageTypes),
  });
}

/** As getNetworkProgress, per country and usage type (Map & Stats). */
export function getNetworkProgressByCountry(region: RegionId): Promise<ProgressByCountry> {
  return getPublic("progress/by-country", { region });
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
