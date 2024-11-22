import fs from "fs";
import railwayData, { usageDict } from "./railwayData";
import mergeCoordinateLists from "./mergeCoordinateLists";

if (process.argv.length !== 3) {
  console.error('Usage: npm run build country_code');
  process.exit(1);
}

if (!fs.existsSync(`${process.argv[2]}.geojson`)) {
  console.error(`Missing file: ${process.argv[2]}.geojson. Generate the geojson first.`);
  process.exit(1);
}

type Coord = [x: number, y: number];

type Geometry = {
  type: "Point"
  coordinates: Coord
} | {
  type: "LineString"
  coordinates: Coord[]
}

type Feature = {
  type: "Feature"
  geometry: Geometry
  properties: {
    "@id": number
    railway: string
    subway: string
  }
}

type ProcessedFeature = {
  type: "Feature"
  geometry: Geometry
  properties: {
    "@id": number | string
    name: string
    description: string
    track_id: string
    railway: string
    _umap_options: {
      color: string
    };
  }
}

type EntryData = {
  features: Feature[]
}

fs.readFile(`${process.argv[2]}.geojson`, function (err, data) {
  const parsedData: EntryData = JSON.parse(data.toString());

  const prunedFeatures = parsedData.features
    .filter((feat) => {
      if (feat.geometry.type === "Point") {
        if (!["station", "halt"].includes(feat.properties.railway) || feat.properties.subway) return false;
        return true;
      }
      if (feat.geometry.type === "LineString") {
        if (feat.properties.railway === "rail") return true;
        if (feat.properties.railway === "narrow_gauge") return true;
        return false;
      }
      return false;
    })
    .map((feat, index) => ({
      ...feat,
      properties: Object.fromEntries(Object.entries(feat.properties)
        .filter(([key, val]) => {
          if (key === "@id") return true;
          if (feat.geometry.type === "Point") {
            if (["name", "railway"].includes(key)) return true;
          }
          if (feat.geometry.type === "LineString") {
            if (["name", "railway", "usage"].includes(key)) return true;
          }
          return false;
        })
      ),
    })) as Feature[];

  const ids = prunedFeatures.map((feat) => feat.properties["@id"]);
  if (ids.length !== new Set(ids).size) {
    console.error('There are duplicate IDs in the pruned list! Cannot continue.');
    process.exit(1);
  }

  const trackPartCount = new Map();
  let mergedFeatures: (Feature | ProcessedFeature)[] = prunedFeatures;
  console.log(`Total railways: ${railwayData.length}`);
  railwayData.forEach((railway, index) => {
    console.log(`Processing: ${index + 1}/${railwayData.length}: ${railway.local_number} ${railway.from} - ${railway.to}`)
    const wayIds = railway.ways.split(";").map(Number);
    const coordinatesToMerge = mergedFeatures
      .filter((f) => typeof f.properties["@id"] === "number" && railway.ways.split(";").map(Number).includes(f.properties["@id"]))
      .map((f) => f.geometry.coordinates as Coord[]);

    const trackKey = `cz${railway.local_number}`
    trackPartCount.set(trackKey, (trackPartCount.get(trackKey) || 0) + 1);

    const mergedRailway: ProcessedFeature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: mergeCoordinateLists(coordinatesToMerge),
      },
      properties: {
        name: `Trať ${railway.local_number}: ${railway.from} – ${railway.to}`,
        description: `${railway.usage.split(";").map((entry) => (usageDict as Record<string, string>)[entry]).join(", ")}, ${railway.operator}`,
        '@id': railway.ways,
        track_id: `cz${railway.local_number}${String.fromCharCode(96 + trackPartCount.get(trackKey))}`,
        railway: 'rail',
        _umap_options: { "color": railway.custom?.last_ride ? "DarkGreen" : "Crimson" }
      },
    };

    mergedFeatures = [
      ...mergedFeatures.filter((f) =>  typeof f.properties["@id"] === "number" && !wayIds.includes(f.properties["@id"])),
      mergedRailway
    ]
  });

  fs.writeFileSync('cz-filtered.geojson', JSON.stringify({
    "type": "FeatureCollection",
    "features": mergedFeatures,
  }), 'utf8');

  const mergedOnly = mergedFeatures.filter((feat) => {
    if (feat.geometry.type === "LineString" && !("track_id" in feat.properties)) {
      return false;
    }
    return true;
  });

  fs.writeFileSync('cz-merged-only.geojson', JSON.stringify({
    "type": "FeatureCollection",
    "features": mergedOnly,
  }), 'utf8');
}); 
