import { createWriteStream } from "node:fs";
import { transliterate } from "transliteration";
import type { Feature } from "../lib/types";

const args = process.argv.slice(2);

if (args.length < 1 || args.length > 2) {
  console.error("Usage: tsx pruneData.ts country_code [version]");
  console.error("  country_code: Single country code (e.g., croatia)");
  console.error("  version: Optional version suffix (e.g., 250101)");
  console.error("");
  console.error(
    "Reads GeoJSON from stdin and writes pruned output to data/{country_code}-pruned[-{version}].geojson",
  );
  process.exit(1);
}

const countryCode = args[0];
const version = args[1] || "";

/**
 * Transliterates station names from Cyrillic and Greek to Latin characters.
 * Preserves Latin characters with diacritics (e.g., Kadaň-Prunéřov).
 * @param name - The station name to potentially transliterate
 * @returns The transliterated name (or original if already Latin)
 */
function transliterateName(name: string | undefined): string | undefined {
  if (!name) return name;

  // Check if the name contains Cyrillic or Greek characters
  // Cyrillic: U+0400-U+04FF
  // Greek: U+0370-U+03FF
  const hasCyrillicOrGreek = /[\u0400-\u04FF\u0370-\u03FF]/.test(name);

  if (hasCyrillicOrGreek) {
    // Transliterate the name (preserves Latin characters with diacritics)
    return transliterate(name);
  }

  return name;
}

/**
 * A station area is kept only if no station node of the same name already sits
 * within this distance - a few places carry both a railway=station node on the
 * track and a railway=station building beside it, and they are one station.
 */
const STATION_DEDUP_METERS = 150;

/** Station-tagged, and not an underground one (those are out of scope). */
function isStationTagged(feat: Feature): boolean {
  return (
    !!feat.properties.railway &&
    ["station", "halt"].includes(feat.properties.railway) &&
    !feat.properties.subway
  );
}

function filterFeature(feat: Feature): boolean {
  if (feat.geometry.type === "Point") {
    return isStationTagged(feat);
  }
  if (feat.geometry.type === "LineString") {
    if (
      feat.properties.railway &&
      ["rail", "narrow_gauge", "light_rail"].includes(feat.properties.railway)
    )
      return true;
    return false;
  }
  return false;
}

/**
 * A station mapped as an area, reduced to the single Point the rest of the
 * pipeline expects. `fromPolygon` records whether the centroid came from the
 * assembled area or from the bare closed way, so the area wins when osmium
 * exports both for one id.
 */
type AreaStation = {
  id: number;
  name?: string;
  railway: string;
  lon: number;
  lat: number;
  fromPolygon: boolean;
};

/** The outer ring to take the centroid of, or null if the geometry has none. */
function outerRing(geometry: Feature["geometry"]): [number, number][] | null {
  if (geometry.type === "LineString") {
    return geometry.coordinates as [number, number][];
  }
  if (geometry.type === "Polygon") {
    return (geometry.coordinates as [number, number][][])[0] ?? null;
  }
  if (geometry.type === "MultiPolygon") {
    // Stations are single polygons in practice; take the largest just in case.
    const polygons = geometry.coordinates as [number, number][][][];
    let largest: [number, number][] | null = null;
    let largestArea = -1;
    for (const polygon of polygons) {
      const ring = polygon[0];
      if (!ring) continue;
      const area = Math.abs(signedRingArea(ring));
      if (area > largestArea) {
        largestArea = area;
        largest = ring;
      }
    }
    return largest;
  }
  return null;
}

/** Shoelace area of a ring, in square degrees - only its sign and magnitude matter here. */
function signedRingArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return sum / 2;
}

/**
 * Centroid of a ring in lon/lat. Degrees are treated as planar, which is fine
 * at the scale of a station building. Falls back to the mean of the vertices
 * for a degenerate ring (zero area), where the shoelace centroid is undefined.
 */
function ringCentroid(ring: [number, number][]): [number, number] {
  const area = signedRingArea(ring);
  if (area !== 0) {
    let lon = 0;
    let lat = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      lon += (ring[j][0] + ring[i][0]) * cross;
      lat += (ring[j][1] + ring[i][1]) * cross;
    }
    return [lon / (6 * area), lat / (6 * area)];
  }
  const lon = ring.reduce((acc, c) => acc + c[0], 0) / ring.length;
  const lat = ring.reduce((acc, c) => acc + c[1], 0) / ring.length;
  return [lon, lat];
}

/** Equirectangular approximation - plenty at dedup distances. */
function metersBetween(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad * Math.cos(((aLat + bLat) / 2) * toRad);
  return Math.hypot(dLat, dLon) * 6371000;
}

/** Name reduced to a comparison key: no case, no diacritics, no punctuation. */
function stationNameKey(name: string | undefined): string {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Records a station mapped as an area (or as the bare closed way osmium also
 * exports for it), keeping the better geometry when both arrive for one id.
 */
function collectAreaStation(feat: Feature, collected: Map<number, AreaStation>): void {
  const id = feat.properties["@id"];
  if (typeof id !== "number") return;

  const fromPolygon = feat.geometry.type !== "LineString";
  const existing = collected.get(id);
  if (existing && (existing.fromPolygon || !fromPolygon)) return;

  const ring = outerRing(feat.geometry);
  if (!ring || ring.length < 3) return;

  const [lon, lat] = ringCentroid(ring);
  collected.set(id, {
    id,
    name: feat.properties.name,
    railway: feat.properties.railway as string,
    lon,
    lat,
    fromPolygon,
  });
}

/**
 * The Point feature an area station is written out as. The id is negated: OSM
 * node and way ids are separate namespaces that overlap numerically, and
 * stations.id is a single BIGINT primary key shared by both.
 */
function areaStationToFeature(station: AreaStation): Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [station.lon, station.lat] },
    properties: {
      "@id": -station.id,
      name: station.name,
      railway: station.railway,
    },
  };
}

function pruneFeatureProperties(feat: Feature): Feature {
  const filteredProperties = Object.fromEntries(
    Object.entries(feat.properties)
      .filter(([key]) => {
        if (key === "@id") return true;
        if (feat.geometry.type === "Point") {
          if (["name", "railway"].includes(key)) return true;
        }
        if (feat.geometry.type === "LineString") {
          if (["name", "railway", "usage", "highspeed"].includes(key)) return true;
        }
        return false;
      })
      .map(([key, value]) => {
        // Transliterate station names (Point features only)
        if (key === "name" && feat.geometry.type === "Point") {
          return [key, transliterateName(value as string)];
        }
        return [key, value];
      }),
  );

  return {
    ...feat,
    properties: filteredProperties,
  };
}

async function processStdin(outputFilePath: string) {
  const writeStream = createWriteStream(outputFilePath, "utf8");
  writeStream.write('{"type":"FeatureCollection","features":[');

  let isFirstFeature = true;
  let buffer = "";
  let featureCount = 0;
  let processedCount = 0;

  // Stations mapped as areas are held back until the whole stream has been
  // read: they are written only if no station node of the same name turned up
  // beside them, and osmium can export the same way twice (see collectAreaStation).
  const areaStations = new Map<number, AreaStation>();
  const nodeStationsByName = new Map<string, [number, number][]>();

  // Read from stdin
  process.stdin.setEncoding("utf8");

  for await (const chunk of process.stdin) {
    buffer += chunk;

    // Process complete features in buffer
    let startIndex = 0;
    while (true) {
      const featureStart = buffer.indexOf('{"type":"Feature"', startIndex);
      if (featureStart === -1) break;

      // Find the end of this feature
      let braceCount = 0;
      let featureEnd = -1;

      for (let i = featureStart; i < buffer.length; i++) {
        if (buffer[i] === "{") braceCount++;
        else if (buffer[i] === "}") {
          braceCount--;
          if (braceCount === 0) {
            featureEnd = i;
            break;
          }
        }
      }

      if (featureEnd === -1) break; // Incomplete feature, wait for more data

      const featureJson = buffer.substring(featureStart, featureEnd + 1);
      try {
        const feature: Feature = JSON.parse(featureJson);
        featureCount++;

        if (filterFeature(feature)) {
          const prunedFeature = pruneFeatureProperties(feature);
          if (!isFirstFeature) writeStream.write(",");
          writeStream.write(JSON.stringify(prunedFeature));
          isFirstFeature = false;
          processedCount++;

          if (feature.geometry.type === "Point") {
            const key = stationNameKey(prunedFeature.properties.name as string | undefined);
            if (key) {
              const coords = nodeStationsByName.get(key) ?? [];
              coords.push(feature.geometry.coordinates as [number, number]);
              nodeStationsByName.set(key, coords);
            }
          }
        } else if (isStationTagged(feature)) {
          collectAreaStation(feature, areaStations);
        }

        if (featureCount % 10000 === 0) {
          process.stdout.write(`\r  Processed ${featureCount} features, kept ${processedCount}...`);
        }
      } catch (_e) {
        // Skip malformed features
      }

      startIndex = featureEnd + 1;
    }

    // Keep unprocessed part of buffer
    buffer = buffer.substring(startIndex);
  }

  // Flush the area stations that no station node already stands in for.
  let areaStationCount = 0;
  let areaStationDuplicates = 0;
  for (const station of areaStations.values()) {
    const nearby = nodeStationsByName.get(stationNameKey(station.name)) ?? [];
    const alreadyMapped = nearby.some(
      ([lon, lat]) => metersBetween(station.lon, station.lat, lon, lat) <= STATION_DEDUP_METERS,
    );
    if (alreadyMapped) {
      areaStationDuplicates++;
      continue;
    }

    if (!isFirstFeature) writeStream.write(",");
    writeStream.write(JSON.stringify(pruneFeatureProperties(areaStationToFeature(station))));
    isFirstFeature = false;
    processedCount++;
    areaStationCount++;
  }
  console.log(
    `\n  Area-mapped stations: kept ${areaStationCount}, skipped ${areaStationDuplicates} already mapped as a node`,
  );

  writeStream.write("]}");
  writeStream.end();

  return new Promise<void>((resolve, reject) => {
    writeStream.on("finish", () => {
      console.log(`\n  Final: processed ${featureCount} features, kept ${processedCount}`);
      resolve();
    });
    writeStream.on("error", reject);
  });
}

// Main execution
async function main() {
  const versionSuffix = version ? `-${version}` : "";
  const outputFilePath = `data/${countryCode}-pruned${versionSuffix}.geojson`;

  console.log(`Processing ${countryCode} from stdin...`);
  await processStdin(outputFilePath);
  console.log(`Pruned data written to ${outputFilePath}`);
}

main().catch(console.error);
