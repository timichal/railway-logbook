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
 * The path between two click points, or null if none joins them. `avoidBacktracking`
 * (scenic lines) prefers a combination that doesn't backtrack, see `PathFinderOptions`.
 */
export async function findAdminPath(
  startCoordinate: unknown,
  endCoordinate: unknown,
  { avoidBacktracking = false }: { avoidBacktracking?: boolean } = {},
): Promise<PathResult | null> {
  const start = clickPoint(startCoordinate, "start");
  const end = clickPoint(endCoordinate, "end");
  return new RailwayPathFinder({ avoidBacktracking }).findPathFromCoordinates(pool, start, end);
}
