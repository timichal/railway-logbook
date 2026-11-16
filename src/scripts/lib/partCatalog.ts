import type { Pool } from "pg";
import { coordinateToKey } from "../../lib/coordinateUtils";
import { coordinateDistance } from "./partGeometry";
import type { RailwayPart } from "./partNetwork";

/** Parts per query while loading. A page's GeoJSON is ~14MB of text. */
const PAGE_SIZE = 50_000;

/**
 * Every railway part, held once for a bulk recalculation, so that a route's
 * part load asks Postgres only which parts to load (`PartNetwork.loadAround`)
 * and not for their geometry: encoding, shipping and `JSON.parse`-ing it on
 * every route was most of what a recalculation cost (RECALC_PERFORMANCE.md).
 *
 * **The coordinates are bit-identical to a per-route load's.** They come from
 * the same `ST_AsGeoJSON(geometry)` text through the same `JSON.parse`, and a
 * `Float64Array` holds a double exactly. The length and the endpoint keys are
 * computed by the same functions `PartNetwork.add` uses, on the same numbers.
 *
 * **Compact, because the server has 4GB.** The coordinates sit in one flat
 * array (16 bytes a vertex) and each part is made into a `RailwayPart` only
 * when a route loads it, for that route alone. The 1.5M parts take a ~270MB
 * buffer and ~250MB of heap. Held as `RailwayPart`s, with a `[lng, lat]` array
 * per vertex, they took 1.7GB of heap.
 *
 * It is a snapshot. Only an import writes parts, and it recalculates after its
 * load, so a stale one takes a `verifyRouteData` run alongside an import, whose
 * own recalculation then replaces that run's results. `part` refuses a part id
 * added since; a part changed in place under its id is served as it was.
 */
export class PartCatalog {
  private readonly indexOf = new Map<string, number>();
  private readonly ids: string[] = [];
  private readonly startKeys: string[] = [];
  private readonly endKeys: string[] = [];
  private readonly lengths: number[] = [];
  /** Where each part's coordinates start in `coordinates`, plus one past the last. */
  private readonly offsets: number[] = [0];
  /** lng, lat, lng, lat… of every part in turn. Grown by doubling while loading. */
  private coordinates = new Float64Array(1 << 20);
  /**
   * Parts a per-route load skips too: a geometry other than a LineString, or
   * fewer than two coordinates (`PartNetwork.add`). Known, so that `part` can
   * tell them from parts missing from the snapshot.
   */
  private readonly skipped = new Set<string>();

  private constructor() {}

  get size(): number {
    return this.ids.length;
  }

  /**
   * Load every part. Paged by id, so no single result holds the whole network's
   * GeoJSON (~400MB of text). `ORDER BY rp.id`, the bigint: a bare `ORDER BY id`
   * would bind to the `id::TEXT` output column and page in text order.
   */
  static async load(db: Pool): Promise<PartCatalog> {
    const catalog = new PartCatalog();
    // One string per distinct endpoint, shared by the parts that meet there,
    // rather than one per part end. Dropped once loaded.
    const keys = new Map<string, string>();
    const intern = (key: string) => {
      const known = keys.get(key);
      if (known !== undefined) return known;
      keys.set(key, key);
      return key;
    };

    let after: string | null = null;
    for (;;) {
      const result: { rows: { id: string; geometry_json: string }[] } = await db.query(
        `
        SELECT
          id::TEXT as id,
          ST_AsGeoJSON(geometry) as geometry_json
        FROM railway_parts rp
        WHERE rp.geometry_3857 IS NOT NULL
          AND ($1::BIGINT IS NULL OR rp.id > $1::BIGINT)
        ORDER BY rp.id
        LIMIT ${PAGE_SIZE}
      `,
        [after],
      );
      if (result.rows.length === 0) break;

      for (const row of result.rows) {
        const geom = JSON.parse(row.geometry_json);
        if (geom.type !== "LineString" || geom.coordinates.length < 2) {
          catalog.skipped.add(row.id);
          continue;
        }
        catalog.push(row.id, geom.coordinates, intern);
      }
      after = result.rows[result.rows.length - 1].id;
    }

    // The slack left by doubling stays: under 1/8 of the buffer for the 1.5M
    // parts (~30MB), against a moment with two copies of it to trim it
    return catalog;
  }

  private push(id: string, coordinates: [number, number][], intern: (key: string) => string): void {
    const from = this.offsets[this.offsets.length - 1];
    const to = from + coordinates.length * 2;
    if (to > this.coordinates.length) {
      let capacity = this.coordinates.length * 2;
      while (capacity < to) capacity *= 2;
      const grown = new Float64Array(capacity);
      grown.set(this.coordinates.subarray(0, from));
      this.coordinates = grown;
    }
    for (let i = 0; i < coordinates.length; i++) {
      this.coordinates[from + 2 * i] = coordinates[i][0];
      this.coordinates[from + 2 * i + 1] = coordinates[i][1];
    }

    this.indexOf.set(id, this.ids.length);
    this.ids.push(id);
    this.startKeys.push(intern(coordinateToKey(coordinates[0])));
    this.endKeys.push(intern(coordinateToKey(coordinates[coordinates.length - 1])));
    this.lengths.push(coordinateDistance(coordinates));
    this.offsets.push(to);
  }

  /**
   * The part with this id as a `RailwayPart` of its own, its coordinates new
   * arrays. Null for a part a per-route load skips too. Throws for an id not in
   * the snapshot: one added after it was taken, and searching without the part
   * would quietly give a different path.
   */
  part(id: string): RailwayPart | null {
    const index = this.indexOf.get(id);
    if (index === undefined) {
      if (this.skipped.has(id)) return null;
      throw new Error(`Railway part ${id} was added after the part catalog was loaded`);
    }

    const from = this.offsets[index];
    const to = this.offsets[index + 1];
    // Pushed, not assigned into `new Array(n)`, which would leave it holey
    const coordinates: [number, number][] = [];
    for (let i = from; i < to; i += 2) {
      coordinates.push([this.coordinates[i], this.coordinates[i + 1]]);
    }
    return {
      id: this.ids[index],
      coordinates,
      startPoint: coordinates[0],
      endPoint: coordinates[coordinates.length - 1],
      startKey: this.startKeys[index],
      endKey: this.endKeys[index],
      lengthMeters: this.lengths[index],
    };
  }
}
