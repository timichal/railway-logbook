/**
 * Where an opened `JourneyCard` reads and saves its journey: the database for a
 * signed-in user (My Trips), localStorage for an anonymous one (My Journeys). One
 * card over both, so the two lists look and behave alike.
 */

import { ActionError, unwrap } from "./actionResult";
import { deleteJourney, getJourney, saveJourneyEdits } from "./journeyActions";
import * as localStore from "./localStorage";
import type { RegionId } from "./shared/regions";
import type { JourneyEdits, RailwayRoute, RouteBounds } from "./shared/types";
import { getRoutesByIds } from "./userActions";

export interface LoadedJourney {
  journey: { name: string; date: string; description: string | null; trip_id?: number | null };
  routes: RailwayRoute[];
  /** What opening it fits the map to; left out, the map fetches the routes' bounds itself. */
  bounds?: RouteBounds | null;
}

export interface JourneyStore<Id> {
  load(id: Id, region: RegionId): Promise<LoadedJourney>;
  /** The whole edit or nothing of it, so a failed save can be retried as it stands. */
  save(id: Id, edits: JourneyEdits): Promise<void>;
  remove(id: Id): Promise<void>;
}

export const databaseJourneyStore: JourneyStore<number> = {
  load: async (id, region) => unwrap(await getJourney(id, region)),
  save: async (id, edits) => unwrap(await saveJourneyEdits(id, edits)),
  remove: async (id) => unwrap(await deleteJourney(id)),
};

/**
 * Runs a localStorage read or write, passing on the failures it words for the
 * user as an action's would be; anything else the browser throws stays opaque.
 */
async function forUser<T>(access: () => T): Promise<T> {
  try {
    return access();
  } catch (error) {
    throw error instanceof localStore.StorageError
      ? new ActionError(error.message, error.gone)
      : error;
  }
}

/**
 * A logged route the map no longer has, kept as a row so it can still be
 * removed — hidden, it would stay in storage for good, counted but out of reach.
 */
const deletedRoute = (trackId: number): RailwayRoute => ({
  track_id: trackId,
  from_station: `Route #${trackId}`,
  to_station: "no longer on the map",
  description: null,
  usage_type: 0,
  frequency: [],
  geometry: "",
});

export const localJourneyStore: JourneyStore<string> = {
  async load(id) {
    const { journey, parts } = await forUser(() => localStore.getJourneyWithParts(id));
    // Only track ids are stored; the rest of each route comes from the server
    const routes = new Map(
      (await getRoutesByIds(parts.map((part) => part.track_id))).map((r) => [r.track_id, r]),
    );
    return {
      journey,
      routes: parts.map((part) => ({
        ...(routes.get(part.track_id) ?? deletedRoute(part.track_id)),
        partial: part.partial,
        covered_start: part.covered_start,
        covered_end: part.covered_end,
      })),
    };
  },
  save: (id, edits) => forUser(() => localStore.saveJourneyEdits(id, edits)),
  remove: (id) => forUser(() => localStore.deleteJourney(id)),
};
