/**
 * Routes' text (names, note, tags, length) as last read, for the map's sheet.
 *
 * The route tile carries none of it, so a tap reads it by `track_id`
 * (`POST /routes/metadata`). A route already read this session is opened from here
 * at once, offline included, and the read still goes out and replaces it: online, a
 * sheet is as current as it was without this. Held for the app's lifetime, in memory
 * only, and shared by every mount of the map. Track ids are unique across regions, and
 * the text is public, so nothing here belongs to a session or a region. Holding every
 * route of the region on the device, so that one never tapped also opens offline, is
 * Phase 5 (`MOBILE_APP_PLAN.md`).
 */
import type { RailwayRoute } from "@shared/types";
import * as api from "@/api/endpoints";

const held = new Map<number, RailwayRoute>();

export function heldRouteMetadata(trackId: number): RailwayRoute | undefined {
  return held.get(trackId);
}

/** Read from the server and kept; `undefined` for a route the server doesn't know. */
export async function readRouteMetadata(
  trackId: number,
  signal?: AbortSignal,
): Promise<RailwayRoute | undefined> {
  const [route] = await api.routeMetadata([trackId], signal);
  if (route) held.set(trackId, route);
  else held.delete(trackId);
  return route;
}
