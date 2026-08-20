import { once } from "node:events";
import { createWriteStream, renameSync, rmSync } from "node:fs";
import { transliterate } from "transliteration";
import type { Feature } from "../lib/types";
import {
  createFeatureStreamStats,
  describeFeatureStream,
  streamFeatures,
} from "./lib/geojsonFeatureStream";

const args = process.argv.slice(2);

if (args.length < 1 || args.length > 2) {
  console.error("Usage: tsx pruneData.ts region [version]");
  console.error("  region: Region name, used as the output file prefix (e.g., europe, japan)");
  console.error("  version: Optional version suffix (e.g., 250101)");
  console.error("");
  console.error(
    "Reads GeoJSON from stdin and writes pruned output to data/{region}-pruned[-{version}].geojson",
  );
  process.exit(1);
}

const region = args[0];
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

/** Han (kanji), hiragana, katakana - the scripts Japanese station names use. */
const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

/** Han alone. Kana romanizes correctly; kanji does not - see resolveStationName. */
const HAN_PATTERN = /[㐀-䶿一-鿿豈-﫿]/;

/**
 * Romanized-name tags, in the order they are preferred over `name`.
 *
 * `name:ja_rm` is OSM's romaji tag and `name:ja-Latn` the BCP-47 spelling of
 * the same thing; both carry the transcription with its macrons (Tōkyō, Kyōto,
 * Ōsaka). `name:en` comes last because it is an English *name* rather than a
 * transcription, and is routinely written without the diacritics (Tokyo) or
 * with the station suffix in English - so it is the fallback, not the choice.
 */
const ROMANIZED_NAME_TAGS = ["name:ja_rm", "name:ja-Latn", "name:en"] as const;

/** First non-empty romanized tag on the feature, if any. */
function romanizedName(properties: Feature["properties"]): string | undefined {
  for (const tag of ROMANIZED_NAME_TAGS) {
    const value = properties[tag] as string | undefined;
    if (value) return value;
  }
  return undefined;
}

/**
 * The single display name a station is stored under.
 *
 * Japanese stations are tagged in kanji, which the `transliteration` package
 * romanizes through Chinese readings (Tokyo's 東京 comes out "Dong Jing"), so a
 * CJK name is taken from the romanized tags above when OSM carries one - as it
 * does for essentially every station in Japan. Only when all of them are
 * missing do we fall back to transliterating, which romanizes a kana-only name
 * properly and otherwise leaves the original in place: a wrong-language
 * romanization is harder to recognize than the kanji itself.
 *
 * Everything else keeps the previous behaviour - Cyrillic and Greek are
 * transliterated, Latin (diacritics and all) passes through untouched.
 */
function resolveStationName(properties: Feature["properties"]): string | undefined {
  const name = properties.name;
  const romanized = romanizedName(properties);

  if (name && CJK_PATTERN.test(name)) {
    if (romanized) return romanized;
    // Nothing romanized to fall back on. Kana romanizes correctly (なんば ->
    // "nanba"), so transliterate it; kanji does not (新宿 -> "Xin Su", the
    // Chinese reading), so the original is kept - wrong-language romanization
    // is worse than a name the reader can at least match against a sign.
    return HAN_PATTERN.test(name) ? name : transliterate(name);
  }

  if (!name && romanized) return romanized;

  return transliterateName(name);
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
    // Resolved up front, so the name-based dedup below compares the same form
    // of the name that node stations were written out under.
    name: resolveStationName(feat.properties),
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
  // Stations keep a single resolved `name` (see resolveStationName); the
  // romanized name tags are inputs to that choice, never written out.
  if (feat.geometry.type === "Point") {
    return {
      ...feat,
      properties: {
        "@id": feat.properties["@id"],
        name: resolveStationName(feat.properties),
        railway: feat.properties.railway,
      },
    };
  }

  const filteredProperties = Object.fromEntries(
    Object.entries(feat.properties).filter(([key]) => {
      if (key === "@id") return true;
      if (feat.geometry.type === "LineString") {
        if (["name", "railway", "usage", "highspeed"].includes(key)) return true;
      }
      return false;
    }),
  );

  return {
    ...feat,
    properties: filteredProperties,
  };
}

async function processStdin(outputFilePath: string) {
  const writeStream = createWriteStream(outputFilePath, "utf8");
  try {
    return await writeFeatures(writeStream);
  } catch (error) {
    // Close the handle before main() deletes the partial file - on Windows an
    // open stream would make the unlink fail.
    writeStream.destroy();
    await once(writeStream, "close").catch(() => {});
    throw error;
  }
}

async function writeFeatures(writeStream: ReturnType<typeof createWriteStream>) {
  writeStream.write('{"type":"FeatureCollection","features":[');

  let isFirstFeature = true;
  let processedCount = 0;

  // Stations mapped as areas are held back until the whole stream has been
  // read: they are written only if no station node of the same name turned up
  // beside them, and osmium can export the same way twice (see collectAreaStation).
  const areaStations = new Map<number, AreaStation>();
  const nodeStationsByName = new Map<string, [number, number][]>();

  // Read from stdin
  process.stdin.setEncoding("utf8");

  const stats = createFeatureStreamStats();

  for await (const feature of streamFeatures<Feature>(process.stdin, stats)) {
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

    if (stats.total % 10000 === 0) {
      process.stdout.write(`\r  Processed ${stats.total} features, kept ${processedCount}...`);
    }
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

  await new Promise<void>((resolve, reject) => {
    writeStream.on("finish", () => {
      console.log(`\n  Final: ${describeFeatureStream(stats)}, kept ${processedCount}`);
      if (stats.malformed > 0 || stats.truncated) {
        // Never finish quietly on damaged input: a truncated osmium export, or a
        // feature the scanner could not parse, means this pruned file is missing
        // data that the import step would load without noticing.
        reject(
          new Error(
            stats.truncated
              ? "Input ended mid-feature - the osmium export is incomplete"
              : `${stats.malformed} feature(s) failed to parse`,
          ),
        );
        return;
      }
      resolve();
    });
    writeStream.on("error", reject);
  });
}

// Main execution
async function main() {
  const versionSuffix = version ? `-${version}` : "";
  const outputFilePath = `data/${region}-pruned${versionSuffix}.geojson`;
  const partFilePath = `${outputFilePath}.part`;

  console.log(`Processing ${region} from stdin...`);

  // Written under .part and renamed only on success. A short file left at the
  // real name would be taken for finished work: prepare.sh skips a stage whose
  // output exists, and deploy.sh skips preparing a region whose pruned file is
  // already there - so a failure here would quietly ship truncated data.
  try {
    await processStdin(partFilePath);
  } catch (error) {
    rmSync(partFilePath, { force: true });
    throw error;
  }
  renameSync(partFilePath, outputFilePath);

  console.log(`Pruned data written to ${outputFilePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
