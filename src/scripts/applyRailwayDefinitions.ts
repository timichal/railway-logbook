import fs from "fs";
import mergeCoordinateLists from "./mergeCoordinateLists";
import { Usage } from "../lib/enums";
import { Coord, EntryData, Feature, ProcessedFeature, RailwayData } from "../lib/types";

if (process.argv.length !== 3) {
  console.error('Usage: npm run apply country_code');
  process.exit(1);
}

const countryCode = process.argv[2];

if (!fs.existsSync(`data/${countryCode}-pruned.geojson`)) {
  console.error(`Missing file: ${countryCode}-pruned.geojson. Generate the geojson first.`);
  process.exit(1);
}

const getRailwayData = async (countryCode: string) => {
  const file = await import(`../definitions/${countryCode}.ts`);
  return file.railwayData as RailwayData[];
}

fs.readFile(`data/${countryCode}-pruned.geojson`, async function (err, data) {
  const parsedData: EntryData = JSON.parse(data.toString());
  let prunedFeatures = parsedData.features;

  const railwayData =  await getRailwayData(countryCode);

  const trackPartCount = new Map();
  const pointFeatures = prunedFeatures.filter((f) => f.geometry.type === "Point");
  let lineFeatures: (Feature | ProcessedFeature)[] = prunedFeatures.filter((f) => f.geometry.type === "LineString");

  console.log(`Total railways: ${railwayData.length}`);

  railwayData.forEach((railway, index) => {
    console.log(`Processing: ${index + 1}/${railwayData.length}: ${railway.local_number} ${railway.from} - ${railway.to}`)
    const wayIds = railway.ways.split(";").map(Number);
    const coordinatesToMerge = lineFeatures
      .filter((f) => (
        typeof f.properties["@id"] === "number"
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
        description: railway.description || '',
        '@id': railway.ways,
        track_id: `${trackKey}${String.fromCharCode(96 + trackPartCount.get(trackKey))}`,
        usage: railway.usage,
        primary_operator: railway.primary_operator,
        ...(railway.custom?.last_ride && { last_ride: railway.custom.last_ride }),
        ...(railway.custom?.note && { note: railway.custom.note }),
      },
    };

    lineFeatures = [
      ...lineFeatures.filter((f) => (typeof f.properties["@id"] === "number" && !wayIds.includes(f.properties["@id"])) || typeof f.properties["@id"] === "string"),
      mergedRailway
    ]
  });

  const mergedFeatures = [...pointFeatures, ...lineFeatures];

  fs.writeFileSync(`data/${countryCode}-combined.geojson`, JSON.stringify({
    "type": "FeatureCollection",
    "features": mergedFeatures,
  }), 'utf8');
}); 
