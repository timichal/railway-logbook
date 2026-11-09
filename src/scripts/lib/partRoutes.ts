import type { Client, Pool } from "pg";

/**
 * Which routes run along which railway parts: part id → the track ids of the
 * routes lying on it. What `RailwayPathFinder`'s `avoidOtherRoutes` keeps a route
 * off, so that a route keeps to track of its own where it can.
 *
 * A route runs along a part when the part's midpoint lies within
 * `ON_PART_DEGREES` of the route's geometry. A route's geometry is made of its
 * parts' own coordinates, so on the same map the match is exact; the tolerance
 * only absorbs the rounding, and stays well under the 4–5m between parallel
 * tracks, which must not count as taken. The midpoint rather than the whole part:
 * a route's end parts are cut at its click points, and a part counts as the
 * route's only where it covers the middle of it.
 *
 * Closed routes are left out: their geometry is frozen, and the track may since
 * carry another route.
 *
 * Long routes are cut into short pieces (`ST_Subdivide`) before the join, so the
 * index on the parts is probed with tight boxes rather than a whole route's.
 * Without it the network-wide load took 2.6 minutes; with it, 26–41s.
 */
export type PartRoutes = ReadonlyMap<string, readonly number[]>;

/** ~1.5m north–south, less east–west (degrees of longitude shrink with latitude). */
const ON_PART_DEGREES = 1.5e-5;

/** How many vertices each route piece may have (`ST_Subdivide`). */
const PIECE_VERTICES = 32;

function collect(rows: { part_id: string; track_id: number }[]): Map<string, number[]> {
  const byPart = new Map<string, number[]>();
  for (const { part_id, track_id } of rows) {
    const routes = byPart.get(part_id);
    if (routes) routes.push(track_id);
    else byPart.set(part_id, [track_id]);
  }
  return byPart;
}

/**
 * Every part's routes, network-wide: the snapshot a bulk recalculation takes once
 * before it starts, so every route is judged against the others as they stood
 * then, whichever order the workers take them in.
 */
export async function loadAllPartRoutes(db: Client | Pool): Promise<PartRoutes> {
  const result = await db.query<{ part_id: string; track_id: number }>(`
    WITH pieces AS (
      SELECT track_id, ST_Subdivide(geometry, ${PIECE_VERTICES}) AS g
      FROM railway_routes
      WHERE NOT closed
    )
    SELECT DISTINCT rp.id::TEXT AS part_id, pieces.track_id
    FROM pieces
    JOIN railway_parts rp ON ST_DWithin(rp.geometry, pieces.g, ${ON_PART_DEGREES})
    WHERE ST_DWithin(ST_LineInterpolatePoint(rp.geometry, 0.5), pieces.g, ${ON_PART_DEGREES})
  `);
  return collect(result.rows);
}

/**
 * The routes of the parts within `bufferMeters` of any of the coordinates (and a
 * few beyond: each coordinate's area is its circle's bounding box), as the
 * network now stands. For a single search, the admin's preview; ~250ms for a 50km
 * area. One box per coordinate, as `PartNetwork.loadAround` loads one circle per
 * coordinate: a box spanning both ends of a 400km line would take in most of the
 * network.
 */
export async function loadPartRoutesAround(
  db: Client | Pool,
  coordinates: [number, number][],
  bufferMeters: number,
): Promise<PartRoutes> {
  if (coordinates.length === 0) return new Map();
  const values: number[] = [];
  const boxes = coordinates.map(([lng, lat]) => {
    const latDegrees = bufferMeters / 111_320;
    const lngDegrees =
      latDegrees / Math.cos((Math.min(89, Math.abs(lat) + latDegrees) * Math.PI) / 180);
    const at = values.push(lng - lngDegrees, lat - latDegrees, lng + lngDegrees, lat + latDegrees);
    return `(ST_MakeEnvelope($${at - 3}, $${at - 2}, $${at - 1}, $${at}, 4326))`;
  });

  const result = await db.query<{ part_id: string; track_id: number }>(
    `
    WITH boxes (box) AS (VALUES ${boxes.join(", ")}),
    pieces AS (
      SELECT r.track_id, ST_Subdivide(ST_ClipByBox2D(r.geometry, boxes.box), ${PIECE_VERTICES}) AS g
      FROM railway_routes r
      JOIN boxes ON r.geometry && boxes.box
      WHERE NOT r.closed
    )
    SELECT DISTINCT rp.id::TEXT AS part_id, pieces.track_id
    FROM pieces
    JOIN railway_parts rp ON ST_DWithin(rp.geometry, pieces.g, ${ON_PART_DEGREES})
    WHERE ST_DWithin(ST_LineInterpolatePoint(rp.geometry, 0.5), pieces.g, ${ON_PART_DEGREES})
    `,
    values,
  );
  return collect(result.rows);
}
