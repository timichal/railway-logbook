import type { Client, Pool, PoolClient } from "pg";
import { coordinateToKey } from "../../lib/coordinateUtils";
import { withinMetersSql } from "../../lib/mercatorDistance";
import { coordinateDistance, pointToSegmentDistance } from "./partGeometry";

/** One OSM railway way, as the recalculation pathfinder holds it. */
export interface RailwayPart {
  id: string;
  coordinates: [number, number][];
  startPoint: [number, number];
  endPoint: [number, number];
  /** `coordinateToKey` of the endpoints, which the search compares on every hop. */
  startKey: string;
  endKey: string;
  /**
   * Haversine length (`coordinateDistance`), summed segment by segment from 0 — the same additions in
   * the same order the search used to repeat on every relaxation, so the same
   * number to the bit.
   */
  lengthMeters: number;
}

/**
 * The railway parts loaded around a route's click points, and which of them
 * meet: two parts are connected when they share an endpoint coordinate, which is
 * how OSM ways are joined.
 *
 * Loading is additive — a caller may load around a second area on top of an
 * already-populated network — and `clear()` empties it.
 */
export class PartNetwork {
  private parts: Map<string, RailwayPart> = new Map();
  private coordToPartIds: Map<string, string[]> = new Map();
  /**
   * `connected`'s answers, built on first ask. A part's neighbours depend on
   * every part loaded, not only on itself, and loading is additive — so this
   * cannot be filled in at parse time, and is emptied whenever the loaded set
   * changes.
   */
  private neighbours: Map<string, readonly string[]> = new Map();

  get(partId: string): RailwayPart | undefined {
    return this.parts.get(partId);
  }

  has(partId: string): boolean {
    return this.parts.has(partId);
  }

  /**
   * Clear all loaded railway parts data
   */
  clear(): void {
    this.parts.clear();
    this.coordToPartIds.clear();
    this.neighbours.clear();
  }

  /**
   * Load every railway part within `bufferMeters` of any of the given coordinates.
   *
   * **One query for all of them**, not one per coordinate. A route's two
   * endpoints are usually closer together than the buffer is wide, so their
   * disks overlap almost entirely — and a second query re-selects, re-encodes as
   * GeoJSON and re-transfers every part in the overlap, only for it to be
   * dropped as a duplicate.
   *
   * `ST_DWithin` against the GIST-indexed `geometry_3857` (`withinMetersSql`,
   * each radius scaled at its own coordinate's latitude) rather than
   * `ST_Intersects` against a materialised `ST_Buffer`: the same set, without
   * building a 32-gon per call and without the round trip back through WGS84.
   */
  async loadAround(
    dbClient: Client | Pool,
    coordinates: [number, number][],
    bufferMeters: number,
  ): Promise<void> {
    if (coordinates.length === 0) return;

    const client = await getClient(dbClient);

    try {
      const values: number[] = [];
      const withinAny = coordinates
        .map((coordinate) => {
          const lng = values.push(coordinate[0]);
          const lat = values.push(coordinate[1]);
          const radius = values.push(bufferMeters);
          return withinMetersSql(
            "rp.geometry_3857",
            `ST_Transform(ST_SetSRID(ST_MakePoint($${lng}, $${lat}), 4326), 3857)`,
            `$${radius}`,
            `$${lat}`,
          );
        })
        .join(" OR ");

      const result = await client.query<{ id: string; geometry_json: string }>(
        `
        SELECT
          id::TEXT as id,
          ST_AsGeoJSON(geometry) as geometry_json
        FROM railway_parts rp
        WHERE rp.geometry_3857 IS NOT NULL
          AND (${withinAny})
        ORDER BY id
      `,
        values,
      );

      // A part already loaded is skipped before its GeoJSON is parsed, not after:
      // with additive loading, the overlap with the earlier area is every part in it
      const parts: { id: string; coordinates: [number, number][] }[] = [];
      for (const row of result.rows) {
        const id = String(row.id);
        if (this.parts.has(id)) continue;
        const geom = JSON.parse(row.geometry_json);
        if (geom.type === "LineString") parts.push({ id, coordinates: geom.coordinates });
      }
      this.add(parts);
    } finally {
      releaseClient(dbClient, client);
    }
  }

  /**
   * Store parts in memory, skipping any already loaded and any with fewer than two
   * coordinates — a part with one has no segment to orient, measure or cut.
   */
  add(parts: { id: string; coordinates: [number, number][] }[]): void {
    let added = false;

    for (const { id, coordinates } of parts) {
      // The same part can arrive twice (loading is additive). Skipping it here
      // keeps coordToPartIds free of duplicate ids.
      if (this.parts.has(id) || coordinates.length < 2) continue;

      const startPoint = coordinates[0];
      const endPoint = coordinates[coordinates.length - 1];
      const startKey = coordinateToKey(startPoint);
      const endKey = coordinateToKey(endPoint);

      this.parts.set(id, {
        id,
        coordinates,
        startPoint,
        endPoint,
        startKey,
        endKey,
        lengthMeters: coordinateDistance(coordinates),
      });
      added = true;

      // Add to coordinate mapping for connection lookups
      if (!this.coordToPartIds.has(startKey)) {
        this.coordToPartIds.set(startKey, []);
      }
      if (!this.coordToPartIds.has(endKey)) {
        this.coordToPartIds.set(endKey, []);
      }

      this.coordToPartIds.get(startKey)!.push(id);
      if (startKey !== endKey) {
        this.coordToPartIds.get(endKey)!.push(id);
      }
    }

    // A new part is a new neighbour of whatever it touches
    if (added) this.neighbours.clear();
  }

  /**
   * Get all part IDs connected to a given part (sorted deterministically).
   *
   * Cached per part, because the label-correcting search pops the same part
   * many times over. The returned array is shared — callers must not mutate it.
   */
  connected(partId: string): readonly string[] {
    const cached = this.neighbours.get(partId);
    if (cached) return cached;

    const part = this.parts.get(partId);
    if (!part) return [];

    const connected = new Set<string>();

    // Check connections at start coordinate
    for (const id of this.coordToPartIds.get(part.startKey) ?? []) {
      if (id !== partId) connected.add(id);
    }

    // Check connections at end coordinate
    for (const id of this.coordToPartIds.get(part.endKey) ?? []) {
      if (id !== partId) connected.add(id);
    }

    // Sort for deterministic BFS ordering
    const sorted = Array.from(connected).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    this.neighbours.set(partId, sorted);
    return sorted;
  }

  /**
   * Find all railway parts containing a coordinate (within tolerance), in load
   * order. Checks if coordinate lies on any segment, not just vertices.
   */
  partsContaining(coordinate: [number, number], toleranceMeters: number): string[] {
    const matchingParts: string[] = [];

    for (const [partId, part] of this.parts) {
      for (let i = 0; i < part.coordinates.length - 1; i++) {
        const dist = pointToSegmentDistance(
          coordinate,
          part.coordinates[i],
          part.coordinates[i + 1],
        );
        if (dist <= toleranceMeters) {
          matchingParts.push(partId);
          break;
        }
      }
    }

    return matchingParts;
  }
}

/**
 * Get a database client from Pool or Client
 */
async function getClient(dbClient: Client | Pool): Promise<Client | PoolClient> {
  if ("totalCount" in dbClient) {
    return await (dbClient as Pool).connect();
  }
  return dbClient as Client;
}

/**
 * Release client if it was obtained from a Pool
 */
function releaseClient(original: Client | Pool, client: Client | PoolClient): void {
  if ("totalCount" in original && "release" in client) {
    client.release();
  }
}
