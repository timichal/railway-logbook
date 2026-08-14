import fs from "node:fs";
import type { Client } from "pg";

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

/**
 * How close a railway part has to run for a station to show on the user map.
 */
export const STATION_RAIL_PROXIMITY_METERS = 250;

/**
 * Recompute stations.near_railway — TRUE when a railway part runs within
 * STATION_RAIL_PROXIMITY_METERS of the station. Only these are served to the
 * user map (public_stations_tile); the admin map keeps seeing every station.
 *
 * Distances are measured in EPSG:3857 so the GIST index on geometry_3857 is
 * usable (a ::geography cast can't use it). Web Mercator inflates distance by
 * 1/cos(lat), so the threshold is scaled by the same factor per station.
 */
export async function updateStationRailProximity(client: Client): Promise<number> {
  const result = await client.query(`
    UPDATE stations s
    SET near_railway = EXISTS (
      SELECT 1
      FROM railway_parts p
      WHERE ST_DWithin(
        p.geometry_3857,
        s.coordinates_3857,
        ${STATION_RAIL_PROXIMITY_METERS} / GREATEST(cos(radians(ST_Y(s.coordinates))), 0.01)
      )
    )
  `);

  const { rows } = await client.query<{ near: string }>(
    `SELECT count(*) AS near FROM stations WHERE near_railway`,
  );

  console.log(
    `- Stations within ${STATION_RAIL_PROXIMITY_METERS}m of a railway part: ${rows[0].near} of ${result.rowCount}`,
  );

  return Number(rows[0].near);
}

/**
 * Load stations and railway parts from a GeoJSON file into the database
 * Clears existing data before loading
 */
export async function loadStationsAndParts(
  client: Client,
  geojsonPath: string,
): Promise<LoadResult> {
  console.log(`Loading data from ${geojsonPath}...`);

  // Clear existing data
  console.log("Clearing existing data...");
  await client.query("DELETE FROM railway_parts");
  await client.query("DELETE FROM stations");

  let stationsCount = 0;
  let partsCount = 0;

  console.log("Reading GeoJSON file...");
  const fileContent = fs.readFileSync(geojsonPath, "utf8");
  console.log("Parsing JSON...");

  // Parse in chunks to manage memory
  const BATCH_SIZE = 1000;
  let stationRows: string[] = [];
  let partRows: string[] = [];

  // Use a more memory-efficient parsing approach
  const startIndex = fileContent.indexOf('"features":[') + '"features":['.length;
  const endIndex = fileContent.lastIndexOf("]");

  // Process features in batches by parsing them incrementally
  const currentPos = startIndex;
  let featureCount = 0;
  let braceDepth = 0;
  let currentFeature = "";
  let inString = false;
  let escapeNext = false;

  console.log("Processing features in batches...");

  for (let i = currentPos; i < endIndex; i++) {
    const char = fileContent[i];

    if (escapeNext) {
      escapeNext = false;
      currentFeature += char;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      currentFeature += char;
      continue;
    }

    if (char === '"') {
      inString = !inString;
    }

    if (!inString) {
      if (char === "{") braceDepth++;
      if (char === "}") braceDepth--;
    }

    currentFeature += char;

    // When we complete a feature object
    if (braceDepth === 0 && currentFeature.trim().length > 0 && !inString) {
      try {
        const feature: GeoJSONFeature = JSON.parse(currentFeature.replace(/^,\s*/, ""));
        featureCount++;

        const { geometry, properties } = feature;

        if (geometry.type === "Point") {
          // Handle stations
          const [lon, lat] = geometry.coordinates as [number, number];
          const id = properties["@id"];
          const name = (properties.name || "Unknown Station").replace(/'/g, "''");

          stationRows.push(`(${id}, '${name}', ST_MakePoint(${lon}, ${lat}))`);
          stationsCount++;
        } else if (geometry.type === "LineString") {
          // Handle railway parts
          if (!properties["@id"]) {
            continue;
          }

          const coords = geometry.coordinates as number[][];
          const coordsStr = coords.map((coord) => `${coord[0]} ${coord[1]}`).join(",");
          const lineString = `LINESTRING(${coordsStr})`;
          const id = properties["@id"];
          const usage = properties.usage
            ? `'${String(properties.usage).replace(/'/g, "''")}'`
            : "NULL";
          const highspeed = properties.highspeed === "yes" ? "TRUE" : "FALSE";

          partRows.push(`(${id}, ST_GeomFromText('${lineString}', 4326), ${usage}, ${highspeed})`);
          partsCount++;
        }

        // Insert batches when they reach BATCH_SIZE
        if (stationRows.length >= BATCH_SIZE) {
          await client.query(`
            INSERT INTO stations (id, name, coordinates)
            VALUES ${stationRows.join(", ")}
            ON CONFLICT (id) DO NOTHING
          `);
          stationRows = [];
        }

        if (partRows.length >= BATCH_SIZE) {
          await client.query(`
            INSERT INTO railway_parts (id, geometry, usage, highspeed)
            VALUES ${partRows.join(", ")}
            ON CONFLICT (id) DO UPDATE SET usage = EXCLUDED.usage, highspeed = EXCLUDED.highspeed, updated_at = CURRENT_TIMESTAMP
          `);
          partRows = [];
        }

        if (featureCount % 10000 === 0) {
          process.stdout.write(
            `\rProcessed ${featureCount} features (${stationsCount} stations, ${partsCount} parts)...`,
          );
        }
      } catch (_e) {
        // Skip malformed features
      }

      currentFeature = "";
    }
  }

  console.log(`\nProcessed ${featureCount} features total`);

  // Insert remaining batches
  if (stationRows.length > 0) {
    console.log(`Inserting final batch of ${stationRows.length} stations...`);
    await client.query(`
      INSERT INTO stations (id, name, coordinates)
      VALUES ${stationRows.join(", ")}
      ON CONFLICT (id) DO NOTHING
    `);
  }

  if (partRows.length > 0) {
    console.log(`Inserting final batch of ${partRows.length} railway parts...`);
    await client.query(`
      INSERT INTO railway_parts (id, geometry, usage, highspeed)
      VALUES ${partRows.join(", ")}
      ON CONFLICT (id) DO UPDATE SET usage = EXCLUDED.usage, highspeed = EXCLUDED.highspeed, updated_at = CURRENT_TIMESTAMP
    `);
  }

  // Both tables are fully loaded only now, so the proximity flag is computed last
  console.log("Flagging stations near a railway part...");
  await updateStationRailProximity(client);

  console.log(`Data loading completed successfully!`);
  console.log(`- Stations loaded: ${stationsCount}`);
  console.log(`- Railway parts loaded: ${partsCount}`);

  return { stationsCount, partsCount };
}
