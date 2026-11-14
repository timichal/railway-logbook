import type { RegionId } from "@/lib/shared/regions";
import type { RouteDetails } from "@/lib/shared/types";

/**
 * The route details the web map reads by track id (`RouteDetails`): the route
 * tile carries only what the layers style and filter by, so a popup or a click
 * looks up the rest here.
 *
 * One region's details come in one request (`GET /api/route-details`), made as a
 * map's interactions attach, so by the time a pointer reaches a route they are
 * nearly always here. Until then a lookup comes back empty, and whoever asked
 * listens (`onRouteDetails`) to draw again when they arrive. Kept for the page's
 * lifetime: track ids are unique across regions, so a region switch keeps both.
 */

/**
 * How long a failed load stands, so that the lookups meanwhile (every route a
 * pointer crosses) don't each ask a failing server for the whole region again.
 */
const RETRY_AFTER_MS = 30_000;

const details = new Map<number, RouteDetails>();
/** Per region, the latest load started: the one whose answer is written. */
const loads = new Map<RegionId, Promise<void>>();
const listeners = new Set<() => void>();
/** Ids a reload was already spent on, so one that never comes doesn't loop. */
const reloadedFor = new Set<number>();

/**
 * Fetch a region's details, once. `reload` asks again (the admin, after a save):
 * the browser revalidates, so an unchanged answer costs a 304. A failed load is
 * forgotten after `RETRY_AFTER_MS`, so a later lookup tries again.
 */
export function loadRouteDetails(
  region: RegionId,
  { reload = false }: { reload?: boolean } = {},
): Promise<void> {
  const pending = loads.get(region);
  if (pending && !reload) return pending;

  const load: Promise<void> = fetch(`/api/route-details?region=${encodeURIComponent(region)}`)
    .then((response) => {
      if (!response.ok) throw new Error(`Route details: HTTP ${response.status}`);
      return response.json() as Promise<RouteDetails[]>;
    })
    .then((rows) => {
      // Overtaken by a later load (two quick admin saves): answers arrive in any
      // order, and an older one must not write over a newer. Its callers wait for
      // the newer instead.
      const latest = loads.get(region);
      if (latest !== load) return latest;
      for (const row of rows) details.set(row.track_id, row);
      for (const listener of listeners) listener();
    });
  loads.set(region, load);
  load.catch((error) => {
    console.error("Error loading route details:", error);
    setTimeout(() => {
      if (loads.get(region) === load) loads.delete(region);
    }, RETRY_AFTER_MS);
  });
  return load;
}

/**
 * A route's details, or undefined while they are on their way. A route missing
 * from a region already loaded is one made since (the admin's, seen through a
 * tile refresh), so that asks the region again — once per route.
 */
export function routeDetails(trackId: number, region: RegionId): RouteDetails | undefined {
  const found = details.get(trackId);
  if (!found) void routeDetailsAsync(trackId, region);
  return found;
}

/** A route's details, waiting for them if need be; undefined if they never come. */
export async function routeDetailsAsync(
  trackId: number,
  region: RegionId,
): Promise<RouteDetails | undefined> {
  const found = details.get(trackId);
  if (found) return found;

  // A failed region load is not followed by a reload per route: that is the
  // stream of requests `RETRY_AFTER_MS` is there to hold off
  const loaded = await loadRouteDetails(region).then(
    () => true,
    () => false,
  );
  if (loaded && !details.has(trackId) && !reloadedFor.has(trackId)) {
    reloadedFor.add(trackId);
    await loadRouteDetails(region, { reload: true }).catch(() => {});
  }
  return details.get(trackId);
}

/** Called whenever new details arrive; returns the unsubscribe. */
export function onRouteDetails(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
