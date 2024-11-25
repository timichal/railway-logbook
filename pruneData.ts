import fs from "fs";
import { EntryData, Feature } from "./types";

if (process.argv.length !== 3) {
  console.error('Usage: npm run prune country_code');
  process.exit(1);
}

const countryCode = process.argv[2];

if (!fs.existsSync(`data/${countryCode}-rail.geojson`)) {
  console.error(`Missing file: ${countryCode}-rail.geojson. Generate the geojson first.`);
  process.exit(1);
}

fs.readFile(`data/${countryCode}-rail.geojson`, function (err, data) {
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

  fs.writeFileSync(`data/${countryCode}-pruned.geojson`, JSON.stringify({
    "type": "FeatureCollection",
    "features": prunedFeatures,
  }), 'utf8');
}); 
