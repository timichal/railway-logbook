import fs from "fs";
import { ProcessedData, ProcessedFeature } from "./types";

const features: ProcessedFeature[] = [];
const featureIds: (string | number)[] = [];

const folderContent = fs.readdirSync("data/")
const countryFiles = folderContent.filter(file => file.endsWith('-combined.geojson'));
countryFiles.forEach((file) => {
  const content = fs.readFileSync(`data/${file}`);
  const parsedData: ProcessedData = JSON.parse(content.toString());
  const mergedFeatures = parsedData.features.filter((feat) => {
    if (feat.geometry.type === "LineString" && !("track_id" in feat.properties)) {
      return false;
    }
    return true;
  });
  mergedFeatures.forEach((feat) => {
    if (!(featureIds.includes(feat.properties["@id"]))) {
      features.push(feat)
      featureIds.push(feat.properties["@id"])
    }
  })
})

console.log(`Merged a total of ${features.length} railway features.`)

fs.writeFileSync(`data/merged-only.geojson`, JSON.stringify({
  "type": "FeatureCollection",
  "features": features,
}), 'utf8');
