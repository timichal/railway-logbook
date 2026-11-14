/**
 * The admin page's reads, from the `api/admin` route handlers rather than from
 * server actions, for the reason `sessionReads.ts` gives: Next runs a client's
 * actions one at a time, so as actions the page's loads queued behind each other
 * and behind the route preview's path search. Writes stay server actions.
 *
 * A refusal is thrown as an `ActionError` (`fetchJson.ts`).
 */

import type { AdminRouteDetail, AdminRouteSummary, RouteSuggestions } from "./adminRouteQueries";
import type { AdminScenicLine } from "./adminScenicLineQueries";
import { getNoStore } from "./fetchJson";
import type { RegionId } from "./shared/regions";
import type { AdminNote, GeoJSONFeatureCollection, MapSearchResults } from "./shared/types";

function getAdmin<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  return getNoStore(`/api/admin/${path}`, params);
}

export function fetchAdminRoutes(region: RegionId): Promise<AdminRouteSummary[]> {
  return getAdmin("routes", { region });
}

export function fetchAdminRoute(trackId: number): Promise<AdminRouteDetail> {
  return getAdmin(`routes/${trackId}`);
}

export function fetchRouteEndpoints(region: RegionId): Promise<GeoJSONFeatureCollection> {
  return getAdmin("routes/endpoints", { region });
}

export function fetchValidRoutesTotalKm(region: RegionId): Promise<number> {
  return getAdmin("routes/total-km", { region });
}

export function fetchRouteSuggestions(): Promise<RouteSuggestions> {
  return getAdmin("routes/suggestions");
}

export function fetchScenicLines(region: RegionId): Promise<AdminScenicLine[]> {
  return getAdmin("scenic-lines", { region });
}

export function fetchScenicLineEndpoints(region: RegionId): Promise<GeoJSONFeatureCollection> {
  return getAdmin("scenic-lines/endpoints", { region });
}

export function fetchAdminNotes(region: RegionId): Promise<AdminNote[]> {
  return getAdmin("notes", { region });
}

/** One note, or null when it has been deleted. */
export function fetchAdminNote(id: number): Promise<AdminNote | null> {
  return getAdmin(`notes/${id}`);
}

/** The admin map's search box: every station, and lines where the region names them. */
export function searchAdminMap(q: string, region: RegionId): Promise<MapSearchResults> {
  return getAdmin("search", { q, region });
}
