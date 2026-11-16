import fs from "node:fs";
import type { ClientBase } from "pg";
import {
  createFeatureStreamStats,
  describeFeatureStream,
  streamFeatures,
} from "./geojsonFeatureStream";

// GeoJSON types
interface GeoJSONGeometry {
  type: "Point" | "LineString";
  coordinates: number[] | number[][];
}

interface GeoJSONProperties {
  "@id"?: number;
  name?: string;
  [key: string]: unknown;
}

interface GeoJSONFeature {
  type: "Feature";
  geometry: GeoJSONGeometry;
  properties: GeoJSONProperties;
}

interface LoadResult {
  stationsCount: number;
  partsCount: number;
}

/** What loading the parts did to `railway_parts` (see applyStagedParts). */
interface PartChanges {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
}

/**
 * The parts are read into this first, then compared with `railway_parts` (see
 * applyStagedParts). A temp table: private to the loading session, dropped with
 * the transaction whichever way it ends, and written without WAL, trigger or
 * spatial index, which is most of what made inserting into `railway_parts` slow.
 */
const STAGED_PARTS = "railway_parts_staged";

/** Rows are sent in batches; 1000 x 4 parameters stays well under Postgres' 65535. */
const BATCH_SIZE = 1000;

/** Enough of the file's tail to see the `]}` that closes the collection. */
const TAIL_BYTES = 64;

interface StationRow {
  id: number;
  name: string;
  lon: number;
  lat: number;
}

interface PartRow {
  id: number;
  wkt: string;
  usage: string | null;
  highspeed: boolean;
}

/**
 * Refuse the whole import before a single row is touched if any file is missing,
 * empty or truncated.
 *
 * The loader clears stations and drops every part the files don't hold, so a
 * mistyped path or a transfer that died halfway would otherwise wipe the map and
 * only then discover it has nothing to put back — and with one file per region,
 * there is more than one chance to get that wrong. A pruned file ends with the
 * `]}` closing its FeatureCollection, so reading the last bytes catches a
 * truncated download without reading gigabytes.
 */
function validateGeoJSONFiles(paths: string[]): void {
  for (const path of paths) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path);
    } catch {
      throw new Error(`Data file not found: ${path}`);
    }
    if (!stat.isFile()) throw new Error(`Not a file: ${path}`);
    if (stat.size === 0) throw new Error(`Data file is empty: ${path}`);

    const length = Math.min(TAIL_BYTES, stat.size);
    const tail = Buffer.alloc(length);
    const fd = fs.openSync(path, "r");
    try {
      fs.readSync(fd, tail, 0, length, stat.size - length);
    } finally {
      fs.closeSync(fd);
    }

    if (!tail.toString("utf8").trimEnd().endsWith("]}")) {
      throw new Error(
        `Data file looks truncated (does not end with "]}"), refusing to import: ${path}`,
      );
    }
  }
}

/** Insert a batch of stations. Parameterised: names come from OSM, i.e. third parties. */
async function insertStations(client: ClientBase, rows: StationRow[]): Promise<void> {
  if (rows.length === 0) return;

  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const base = index * 4;
    values.push(row.id, row.name, row.lon, row.lat);
    // ST_MakePoint alone yields SRID 0, which neither matches the column's
    // declared 4326 nor survives the ST_Transform that fills coordinates_3857.
    return `($${base + 1}, $${base + 2}, ST_SetSRID(ST_MakePoint($${base + 3}, $${base + 4}), 4326))`;
  });

  await client.query(
    `INSERT INTO stations (id, name, coordinates)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (id) DO NOTHING`,
    values,
  );
}

/**
 * Stage a batch of railway parts. Ids are unique in a pruned file (prepare.sh's
 * merge keeps one version of each way). An id repeated in a later batch keeps
 * its first geometry and takes the last tags; one repeated within a batch fails
 * the import ("cannot affect row a second time").
 */
async function stageParts(client: ClientBase, rows: PartRow[]): Promise<void> {
  if (rows.length === 0) return;

  // A VALUES list rather than one array per column through unnest(), which
  // staged half as fast again (45s against 30s for the whole map, measured).
  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const base = index * 4;
    values.push(row.id, row.wkt, row.usage, row.highspeed);
    return `($${base + 1}, ST_GeomFromText($${base + 2}, 4326), $${base + 3}, $${base + 4})`;
  });

  await client.query(
    `INSERT INTO ${STAGED_PARTS} (id, geometry, usage, highspeed)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (id) DO UPDATE SET
       usage = EXCLUDED.usage,
       highspeed = EXCLUDED.highspeed`,
    values,
  );
}

/**
 * Bring `railway_parts` to the staged set, writing only the rows that differ.
 *
 * Few parts change between two deploys (Czechia over 5 days: 232 of 62.5k), and
 * deleting and reinserting all 1.5M rewrote the table, ran its trigger's
 * transform and rebuilt four indexes for the sake of those few, then left the
 * whole table dead behind it for the recalculation's index scans to wade through.
 * A part has changed when a tag differs or its geometry differs to the bit. Both
 * sides come from the same text through ST_GeomFromText, so an unchanged way
 * parses to the same doubles, and PostGIS's `=` compares the coordinates exactly
 * and in order (a one-ulp shift counts), faster than comparing `::bytea`. A
 * changed part is updated in place and keeps its `created_at` (when it was first
 * imported).
 */
async function applyStagedParts(client: ClientBase): Promise<PartChanges> {
  // Autovacuum never analyses a temp table: without this the joins below are
  // planned for an empty one.
  await client.query(`ANALYZE ${STAGED_PARTS}`);

  const removed = await client.query(
    `DELETE FROM railway_parts p
     WHERE NOT EXISTS (SELECT 1 FROM ${STAGED_PARTS} s WHERE s.id = p.id)`,
  );
  // Two updates, because the trigger refreshing geometry_3857 fires whenever
  // `geometry` is in the SET list, equal or not: a part retagged only keeps its
  // geometry untouched. The second finds the moved parts already retagged.
  const moved = await client.query(
    `UPDATE railway_parts p
     SET geometry = s.geometry,
         usage = s.usage,
         highspeed = s.highspeed,
         updated_at = CURRENT_TIMESTAMP
     FROM ${STAGED_PARTS} s
     WHERE s.id = p.id AND p.geometry IS DISTINCT FROM s.geometry`,
  );
  const retagged = await client.query(
    `UPDATE railway_parts p
     SET usage = s.usage,
         highspeed = s.highspeed,
         updated_at = CURRENT_TIMESTAMP
     FROM ${STAGED_PARTS} s
     WHERE s.id = p.id
       AND (p.usage IS DISTINCT FROM s.usage OR p.highspeed IS DISTINCT FROM s.highspeed)`,
  );
  const added = await client.query(
    `INSERT INTO railway_parts (id, geometry, usage, highspeed)
     SELECT s.id, s.geometry, s.usage, s.highspeed
     FROM ${STAGED_PARTS} s
     WHERE NOT EXISTS (SELECT 1 FROM railway_parts p WHERE p.id = s.id)`,
  );
  const staged = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${STAGED_PARTS}`,
  );

  const counts = {
    added: added.rowCount ?? 0,
    changed: (moved.rowCount ?? 0) + (retagged.rowCount ?? 0),
    removed: removed.rowCount ?? 0,
  };
  return { ...counts, unchanged: staged.rows[0].count - counts.added - counts.changed };
}

/**
 * Load stations and railway parts from GeoJSON files into the database.
 *
 * Stations are emptied and refilled; parts are staged and only their differences
 * written (applyStagedParts). Both happen inside one transaction, so the swap is
 * atomic: a crash halfway leaves the previous map in place instead of a
 * half-loaded one, and readers keep being served the old data until the new set
 * commits. DELETE rather than TRUNCATE for exactly that reason: TRUNCATE takes an
 * ACCESS EXCLUSIVE lock held until commit, which would block every tile query for
 * the length of the import. Nothing here takes more than ROW EXCLUSIVE.
 */
export async function loadStationsAndParts(
  client: ClientBase,
  geojsonPaths: string | string[],
): Promise<LoadResult> {
  const paths = Array.isArray(geojsonPaths) ? geojsonPaths : [geojsonPaths];

  // Before anything is cleared (see validateGeoJSONFiles).
  validateGeoJSONFiles(paths);

  const total: LoadResult = { stationsCount: 0, partsCount: 0 };

  await client.query("BEGIN");
  try {
    // Cleared and staged once, before the first file: the regions share these
    // tables, so doing it per file would drop whichever region was loaded just
    // before. OSM ids are globally unique, so the regions cannot collide.
    console.log("Clearing stations...");
    await client.query("DELETE FROM stations");
    await client.query(
      `CREATE TEMP TABLE ${STAGED_PARTS} (
         id BIGINT PRIMARY KEY,
         geometry GEOMETRY(LINESTRING, 4326) NOT NULL,
         usage TEXT,
         highspeed BOOLEAN NOT NULL
       ) ON COMMIT DROP`,
    );

    for (const path of paths) {
      const result = await loadOneFile(client, path);
      total.stationsCount += result.stationsCount;
      total.partsCount += result.partsCount;
    }

    console.log("Writing the railway parts that changed...");
    const changes = await applyStagedParts(client);
    console.log(
      `Railway parts: ${changes.added} added, ${changes.changed} changed, ${changes.removed} removed, ${changes.unchanged} unchanged`,
    );

    await client.query("COMMIT");
  } catch (error) {
    // A lost connection rolls back on its own; don't let the failed ROLLBACK
    // replace the error that explains why
    await client.query("ROLLBACK").catch(() => {});
    console.error("Load failed — rolled back, the previous map data is still in place.");
    throw error;
  }

  if (paths.length > 1) {
    console.log("");
    console.log(`All ${paths.length} files loaded:`);
    console.log(`- Stations loaded: ${total.stationsCount}`);
    console.log(`- Railway parts read: ${total.partsCount}`);
  }

  return total;
}

/**
 * Load a single GeoJSON file: its stations into the (already cleared) table, its
 * parts into the staging table.
 *
 * The file is streamed rather than read whole: these run to several gigabytes,
 * and holding one as a single string was what forced importMapData's raised heap
 * limit.
 */
async function loadOneFile(client: ClientBase, geojsonPath: string): Promise<LoadResult> {
  console.log(`Loading data from ${geojsonPath}...`);

  let stationsCount = 0;
  let partsCount = 0;
  let stationRows: StationRow[] = [];
  let partRows: PartRow[] = [];

  const stats = createFeatureStreamStats();
  const source = fs.createReadStream(geojsonPath, { encoding: "utf8" });

  for await (const feature of streamFeatures<GeoJSONFeature>(source, stats)) {
    const { geometry, properties } = feature;
    const id = properties["@id"];
    if (typeof id !== "number") continue;

    if (geometry.type === "Point") {
      const [lon, lat] = geometry.coordinates as [number, number];
      stationRows.push({ id, name: properties.name || "Unknown Station", lon, lat });
      stationsCount++;
    } else if (geometry.type === "LineString") {
      const coords = geometry.coordinates as number[][];
      const wkt = `LINESTRING(${coords.map((coord) => `${coord[0]} ${coord[1]}`).join(",")})`;
      partRows.push({
        id,
        wkt,
        usage: typeof properties.usage === "string" ? properties.usage : null,
        highspeed: properties.highspeed === "yes",
      });
      partsCount++;
    }

    if (stationRows.length >= BATCH_SIZE) {
      await insertStations(client, stationRows);
      stationRows = [];
    }
    if (partRows.length >= BATCH_SIZE) {
      await stageParts(client, partRows);
      partRows = [];
    }

    if (stats.total % 10000 === 0) {
      process.stdout.write(
        `\rProcessed ${stats.total} features (${stationsCount} stations, ${partsCount} parts)...`,
      );
    }
  }

  console.log(`\n${describeFeatureStream(stats)}`);

  // A file that ends before its features array closes has lost data; the transaction is
  // rolled back rather than committing a partial map.
  if (stats.truncated) {
    throw new Error(`${geojsonPath} ends before its features array closes — the file is truncated`);
  }
  if (stats.malformed > 0) {
    throw new Error(`${geojsonPath} contains ${stats.malformed} feature(s) that failed to parse`);
  }

  if (stationRows.length > 0) {
    console.log(`Inserting final batch of ${stationRows.length} stations...`);
    await insertStations(client, stationRows);
  }
  if (partRows.length > 0) {
    console.log(`Staging final batch of ${partRows.length} railway parts...`);
    await stageParts(client, partRows);
  }

  console.log(`Data loading completed successfully!`);
  console.log(`- Stations loaded: ${stationsCount}`);
  console.log(`- Railway parts read: ${partsCount}`);

  return { stationsCount, partsCount };
}
