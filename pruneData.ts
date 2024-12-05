import fs from "fs";
import { EntryData, Feature } from "./types";

if (process.argv.length < 3) {
  console.error('Usage: npm run prune country_code1 [country_code ...]');
  process.exit(1);
}

const countryCodes = process.argv.slice(2);

console.log(`Processing ${countryCodes.length} files...`);

countryCodes.forEach((countryCode, index) => {
  const inputFilePath = `data/${countryCode}-rail.tmp.geojson`;
  const outputFilePath = `data/${countryCode}-pruned.geojson`;

  if (!fs.existsSync(inputFilePath)) {
    console.error(`Missing file: ${inputFilePath}. Generate the geojson first. Exitting.`);
    process.exit(1);
  }

  const data = fs.readFileSync(inputFilePath, 'utf8');
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

  fs.writeFileSync(outputFilePath, JSON.stringify({
    "type": "FeatureCollection",
    "features": prunedFeatures,
  }), 'utf8');

  console.log(`(${index + 1}/${countryCodes.length}) Pruned data written to ${outputFilePath}.`);
})
