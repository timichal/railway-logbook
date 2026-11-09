/**
 * The admin's path between two click points, as the map previews it and a scenic
 * line's save finds it again. One search for both, so the save stores — or refuses
 * — exactly what the admin was shown.
 *
 * A plain server-only module rather than part of an action file: every export of
 * a `"use server"` module is a client-callable endpoint.
 */

import { RailwayPathFinder } from "../scripts/lib/railwayPathFinder";
import pool from "./db";
import { ValidationError } from "./errors";
import type { PathResult } from "./shared/types";

/** A click point as the client sent it, refused unless it is a finite [lng, lat]. */
function clickPoint(value: unknown, which: string): [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    throw new ValidationError(`The ${which} point is not a coordinate`);
  }
  return [value[0], value[1]];
}

/**
 * What the admin is drawing: a scenic line, or a route — `trackId` the one whose
 * geometry is being re-picked, null for a new one.
 */
export type AdminPathFor = { scenic: true } | { scenic: false; trackId: number | null };

/**
 * The path between two click points, or null if none joins them. A scenic line's
 * search prefers a combination that doesn't backtrack; a route's keeps off track
 * other routes run along, but never off its own (see `PathFinderOptions`).
 */
export async function findAdminPath(
  startCoordinate: unknown,
  endCoordinate: unknown,
  pathFor: AdminPathFor,
): Promise<PathResult | null> {
  const start = clickPoint(startCoordinate, "start");
  const end = clickPoint(endCoordinate, "end");
  const finder = pathFor.scenic
    ? new RailwayPathFinder({ avoidBacktracking: true })
    : new RailwayPathFinder({ avoidOtherRoutes: { trackId: pathFor.trackId } });
  return finder.findPathFromCoordinates(pool, start, end);
}

/**
 * `AdminPathFor` as a client sent it, refused unless it is one: every export of
 * a `"use server"` module is an endpoint, so its argument is not to be trusted.
 */
export function adminPathFor(value: unknown): AdminPathFor {
  const { scenic, trackId } = (value ?? {}) as { scenic?: unknown; trackId?: unknown };
  if (scenic === true) return { scenic: true };
  if (trackId === null || trackId === undefined) return { scenic: false, trackId: null };
  if (typeof trackId === "number" && Number.isInteger(trackId) && trackId > 0) {
    return { scenic: false, trackId };
  }
  throw new ValidationError("The route being drawn is not a route id");
}
