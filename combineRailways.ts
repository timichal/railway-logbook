import fs from "fs";
import mergeCoordinateLists from "./mergeCoordinateLists";
import { Usage } from "./enums";
import { Coord, EntryData, Feature, ProcessedFeature, RailwayData } from "./types";

if (process.argv.length !== 3) {
  console.error('Usage: npm run combine country_code');
  process.exit(1);
}

const countryCode = process.argv[2];

if (!fs.existsSync(`data/${countryCode}-pruned.geojson`)) {
  console.error(`Missing file: ${countryCode}-pruned.geojson. Generate the geojson first.`);
  process.exit(1);
}

const usageDict = {
  [Usage.Regular]: "Pravidelný provoz",
  [Usage.OnceDaily]: "Provoz jednou denně",
  [Usage.Seasonal]: "Sezónní provoz",
  [Usage.OnceWeekly]: "Provoz jednou týdně",
  [Usage.Weekdays]: "Provoz o pracovních dnech",
  [Usage.Weekends]: "Provoz o víkendech",
  [Usage.Special]: "Provoz při zvláštních příležitostech",
};

fs.readFile(`data/${countryCode}-pruned.geojson`, async function (err, data) {
  const railwayData: RailwayData[] = (await import(`./data/railways/${countryCode}.ts`)).railwayData;
  const parsedData: EntryData = JSON.parse(data.toString());
  const prunedFeatures = parsedData.features;

  const trackPartCount = new Map();
  let mergedFeatures: (Feature | ProcessedFeature)[] = prunedFeatures;
  console.log(`Total railways: ${railwayData.length}`);

  railwayData.forEach((railway, index) => {
    console.log(`Processing: ${index + 1}/${railwayData.length}: ${railway.local_number} ${railway.from} - ${railway.to}`)
    const wayIds = railway.ways.split(";").map(Number);
    const coordinatesToMerge = mergedFeatures
      .filter((f) => (
        f.geometry.type === "LineString"
        && typeof f.properties["@id"] === "number"
        && railway.ways.split(";").map(Number).includes(f.properties["@id"]))
      )
      .map((f) => f.geometry.coordinates as Coord[]);

    const trackKey = `${countryCode}${railway.local_number}`
    trackPartCount.set(trackKey, (trackPartCount.get(trackKey) || 0) + 1);

    const mergedRailway: ProcessedFeature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: mergeCoordinateLists(coordinatesToMerge),
      },
      properties: {
        name: `Trať ${railway.local_number}: ${railway.from} – ${railway.to}`,
        description: `${railway.usage.map((entry) => usageDict[entry]).join(", ")}, ${railway.operator}${railway.custom?.last_ride ? `\n\nNaposledy projeto: ${railway.custom.last_ride}` : ''}${railway.custom?.note ? `\n\n*${railway.custom.note}*` : ''}`,
        '@id': railway.ways,
        track_id: `${trackKey}${String.fromCharCode(96 + trackPartCount.get(trackKey))}`,
        railway: 'rail',
        _umap_options: {
          color: railway.custom?.last_ride ? "DarkGreen" : "Crimson",
          ...(railway.usage[0] === Usage.Special ? { weight: 2 } : {}),
        }
      },
    };

    mergedFeatures = [
      ...mergedFeatures.filter((f) => (typeof f.properties["@id"] === "number" && !wayIds.includes(f.properties["@id"])) || typeof f.properties["@id"] === "string"),
      mergedRailway
    ]
  });

  fs.writeFileSync(`data/${countryCode}-combined.geojson`, JSON.stringify({
    "type": "FeatureCollection",
    "features": mergedFeatures,
  }), 'utf8');

  const mergedOnly = mergedFeatures.filter((feat) => {
    if (feat.geometry.type === "LineString" && !("track_id" in feat.properties)) {
      return false;
    }
    return true;
  });

  fs.writeFileSync(`data/${countryCode}-merged-only.geojson`, JSON.stringify({
    "type": "FeatureCollection",
    "features": mergedOnly,
  }), 'utf8');
}); 
