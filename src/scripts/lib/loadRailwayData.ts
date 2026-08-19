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

export interface LoadResult {
  stationsCount: number;
  partsCount: number;
}

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
 * The loader clears stations and railway_parts before its first insert, so a
 * mistyped path or a transfer that died halfway would otherwise wipe the map and
 * only then discover it has nothing to put back — and with one file per region,
 * there is more than one chance to get that wrong. A pruned file ends with the
 * `]}` closing its FeatureCollection, so reading the last bytes catches a
 * truncated download without reading gigabytes.
 */
export function validateGeoJSONFiles(paths: string[]): void {
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

/** Insert a batch of railway parts, refreshing usage/highspeed on ones already seen. */
async function insertParts(client: ClientBase, rows: PartRow[]): Promise<void> {
  if (rows.length === 0) return;

  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const base = index * 4;
    values.push(row.id, row.wkt, row.usage, row.highspeed);
    return `($${base + 1}, ST_GeomFromText($${base + 2}, 4326), $${base + 3}, $${base + 4})`;
  });

  await client.query(
    `INSERT INTO railway_parts (id, geometry, usage, highspeed)
     VALUES ${tuples.join(", ")}
     ON CONFLICT (id) DO UPDATE SET
       usage = EXCLUDED.usage,
       highspeed = EXCLUDED.highspeed,
       updated_at = CURRENT_TIMESTAMP`,
    values,
  );
}

/**
 * Load stations and railway parts from GeoJSON files into the database.
 *
 * The tables are emptied and refilled inside one transaction, so the swap is
 * atomic: a crash halfway leaves the previous map in place instead of a
 * half-loaded one, and readers keep being served the old data until the new set
 * commits. DELETE rather than TRUNCATE for exactly that reason — TRUNCATE would
 * be faster and leave no dead tuples, but it takes an ACCESS EXCLUSIVE lock held
 * until commit, which would block every tile query for the length of the import.
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
    // Cleared once, before the first file: the regions share these tables, so
    // clearing per file would drop whichever region was loaded just before.
    // OSM ids are globally unique, so the regions cannot collide.
    console.log("Clearing existing data...");
    await client.query("DELETE FROM railway_parts");
    await client.query("DELETE FROM stations");

    for (const path of paths) {
      const result = await loadOneFile(client, path);
      total.stationsCount += result.stationsCount;
      total.partsCount += result.partsCount;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Load failed — rolled back, the previous map data is still in place.");
    throw error;
  }

  if (paths.length > 1) {
    console.log("");
    console.log(`All ${paths.length} files loaded:`);
    console.log(`- Stations loaded: ${total.stationsCount}`);
    console.log(`- Railway parts loaded: ${total.partsCount}`);
  }

  return total;
}

/**
 * Load a single GeoJSON file into the (already cleared) tables.
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
      await insertParts(client, partRows);
      partRows = [];
    }

    if (stats.total % 10000 === 0) {
      process.stdout.write(
        `\rProcessed ${stats.total} features (${stationsCount} stations, ${partsCount} parts)...`,
      );
    }
  }

  console.log(`\n${describeFeatureStream(stats)}`);

  // A file that ends mid-feature has already lost data; the transaction is
  // rolled back rather than committing a partial map.
  if (stats.truncated) {
    throw new Error(`${geojsonPath} ends mid-feature — the file is truncated`);
  }
  if (stats.malformed > 0) {
    throw new Error(`${geojsonPath} contains ${stats.malformed} feature(s) that failed to parse`);
  }

  if (stationRows.length > 0) {
    console.log(`Inserting final batch of ${stationRows.length} stations...`);
    await insertStations(client, stationRows);
  }
  if (partRows.length > 0) {
    console.log(`Inserting final batch of ${partRows.length} railway parts...`);
    await insertParts(client, partRows);
  }

  console.log(`Data loading completed successfully!`);
  console.log(`- Stations loaded: ${stationsCount}`);
  console.log(`- Railway parts loaded: ${partsCount}`);

  return { stationsCount, partsCount };
}
