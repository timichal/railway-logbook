/**
 * Query-string and body parsing for the HTTP API, with a 400 for anything
 * malformed. Nothing here guesses: an absent required parameter is an error,
 * not a default.
 */

import type { LoggedRange } from "../journeyQueries";
import { isRegionId, type RegionId } from "../regions";
import type { CoveredRange } from "../types";
import { ApiError } from "./response";

/**
 * Longest array a client may send in one call. The batch inserts build one
 * placeholder per element, and Postgres caps a statement at 65535 of them.
 */
const MAX_ARRAY_LENGTH = 2000;

/**
 * The `region` parameter, which is never optional.
 *
 * On the web the region comes from a cookie; over HTTP it is explicit, and a
 * silent default would mean a query answering for the other continent (see
 * Regions in CLAUDE.md).
 */
export function requireRegion(url: URL): RegionId {
  const region = url.searchParams.get("region");
  if (!region) {
    throw new ApiError(400, "region is required (europe or japan)");
  }
  if (!isRegionId(region)) {
    throw new ApiError(400, `Unknown region: ${region}`);
  }
  return region;
}

/**
 * The `countries` filter: absent means no filter at all, present-but-empty means
 * filter everything out. The distinction is load-bearing in `progressForUser`,
 * so `?countries=` and no `countries=` must not collapse into one.
 */
export function optionalCountries(url: URL): string[] | undefined {
  const raw = url.searchParams.get("countries");
  if (raw === null) return undefined;
  if (raw.trim() === "") return [];

  return raw
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code));
}

export function optionalInt(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new ApiError(400, `${name} must be an integer`);
  }
  return value;
}

/** A numeric path segment, e.g. the `id` in `/api/v1/journeys/12`. */
export function requireIdParam(value: string, name: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, `${name} must be a positive integer`);
  }
  return id;
}

export type JsonBody = Record<string, unknown>;

/** The request's JSON body, which must be an object. */
export async function readJsonBody(request: Request): Promise<JsonBody> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(400, "Request body must be a JSON object");
  }
  return parsed as JsonBody;
}

export function requireString(body: JsonBody, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, `${key} is required`);
  }
  return value;
}

/** A string that may be absent, empty or explicitly null — all of which mean null. */
export function optionalString(body: JsonBody, key: string): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError(400, `${key} must be a string`);
  }
  return value.trim() === "" ? null : value;
}

/**
 * An integer body field. Not "positive": a station whose OSM feature was an area
 * is stored under a negated id (see stations in CLAUDE.md), so half the station
 * ids in France are negative.
 */
export function requireInt(body: JsonBody, key: string): number {
  const value = body[key];
  if (!Number.isInteger(value) || value === 0) {
    throw new ApiError(400, `${key} must be a non-zero integer`);
  }
  return value as number;
}

export function requireBoolean(body: JsonBody, key: string): boolean {
  const value = body[key];
  if (typeof value !== "boolean") {
    throw new ApiError(400, `${key} must be a boolean`);
  }
  return value;
}

export function requirePositiveInt(body: JsonBody, key: string): number {
  const value = body[key];
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ApiError(400, `${key} must be a positive integer`);
  }
  return value as number;
}

export function optionalPositiveInt(body: JsonBody, key: string): number | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ApiError(400, `${key} must be a positive integer`);
  }
  return value as number;
}

function requireArray(body: JsonBody, key: string): unknown[] {
  const value = body[key];
  if (!Array.isArray(value)) {
    throw new ApiError(400, `${key} must be an array`);
  }
  if (value.length > MAX_ARRAY_LENGTH) {
    throw new ApiError(400, `${key} must hold at most ${MAX_ARRAY_LENGTH} items`);
  }
  return value;
}

export function requireIntArray(body: JsonBody, key: string): number[] {
  return requireArray(body, key).map((item) => {
    if (!Number.isInteger(item)) {
      throw new ApiError(400, `${key} must hold integers`);
    }
    return item as number;
  });
}

export function requireStringArray(body: JsonBody, key: string): string[] {
  return requireArray(body, key).map((item) => {
    if (typeof item !== "string") {
      throw new ApiError(400, `${key} must hold strings`);
    }
    return item as string;
  });
}

/**
 * Fraction ranges the client holds itself, for the coverage overlay of journeys
 * kept on the device. Shape-checked here, then validated and capped by
 * `normalizeCoveredRanges`.
 */
export function requireCoveredRanges(body: JsonBody, key: string): CoveredRange[] {
  return requireArray(body, key).map((item) => {
    if (item === null || typeof item !== "object") {
      throw new ApiError(400, `${key} must hold objects`);
    }
    const range = item as Record<string, unknown>;
    return {
      track_id: Number(range.track_id),
      covered_start: Number(range.covered_start),
      covered_end: Number(range.covered_end),
    };
  });
}

/**
 * The routes logged in one journey, as one array of objects rather than the
 * three positionally-aligned arrays `journeyQueries` takes.
 *
 * Three parallel arrays over the wire is an error waiting to happen — a client
 * that appends to one and not the others sends a mismatch, and the mismatch is
 * only caught by a length check. The split back into columns happens here.
 */
export function requireLoggedRoutes(
  body: JsonBody,
  key: string,
): { trackIds: number[]; partialFlags: boolean[]; coveredRanges: (LoggedRange | null)[] } {
  const items = requireArray(body, key);

  const trackIds: number[] = [];
  const partialFlags: boolean[] = [];
  const coveredRanges: (LoggedRange | null)[] = [];

  for (const item of items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new ApiError(400, `${key} must hold objects`);
    }
    const entry = item as Record<string, unknown>;

    const trackId = entry.trackId;
    if (!Number.isInteger(trackId) || (trackId as number) <= 0) {
      throw new ApiError(400, `${key} entries need a positive integer trackId`);
    }

    const partial = entry.partial ?? false;
    if (typeof partial !== "boolean") {
      throw new ApiError(400, `${key} entries' partial must be a boolean`);
    }

    trackIds.push(trackId as number);
    partialFlags.push(partial);
    coveredRanges.push(coveredRange(entry.covered, key));
  }

  return { trackIds, partialFlags, coveredRanges };
}

function coveredRange(value: unknown, key: string): LoggedRange | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, `${key} entries' covered must be an object`);
  }

  const range = value as Record<string, unknown>;
  const start = Number(range.covered_start);
  const end = Number(range.covered_end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new ApiError(400, `${key} entries' covered needs numeric covered_start and covered_end`);
  }
  return { covered_start: start, covered_end: end };
}
