import fs from "fs";

if (process.argv.length !== 3) {
  console.error('Usage: npm run build country_code');
  process.exit(1);
}

const countryCode = process.argv[2];

if (!fs.existsSync(`${countryCode}.geojson`)) {
  console.error(`Missing file: ${countryCode}.geojson. Generate the geojson first.`);
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

type EntryData = {
  features: Feature[]
}

fs.readFile(`${countryCode}.geojson`, function (err, data) {
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

  fs.writeFileSync(`${countryCode}-pruned.geojson`, JSON.stringify({
    "type": "FeatureCollection",
    "features": prunedFeatures,
  }), 'utf8');
}); 
