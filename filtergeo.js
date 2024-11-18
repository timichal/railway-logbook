import fs from "fs";
import railwayData from "./railwayData.js";
import mergeCoordinateLists from "./mergeCoordinateLists.js";

if (process.argv.length === 2) {
  console.error('Syntax: filtergeo.js geojson_file.geojson');
  process.exit(1);
}

fs.readFile(process.argv[2], function (err, data) {
  const parsedData = JSON.parse(data);

  const prunedFeatures = parsedData.features
    .filter((feat) => {
      if (feat.geometry.type === "Point") {
        if (!["station", "halt"].includes(feat.properties.railway) || feat.properties.subway) return false;
        return true;
      }
      if (feat.geometry.type === "LineString") {
        if (feat.properties.railway === "rail" && ["main", "branch"].includes(feat.properties.usage)) return true;
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
    }));

  const ids = prunedFeatures.map((feat) => feat.properties["@id"]);
  if (ids.length !== new Set(ids).size) {
    console.error('There are duplicate IDs in the pruned list! Cannot continue.');
    process.exit(1);
  }

  let mergedFeatures = prunedFeatures;
  railwayData.forEach((railway) => {
    const toMerge = mergedFeatures
      .filter((f) => railway.ids.includes(f.properties["@id"]))
      .map((f) => f.geometry.coordinates);
    const mergedRailway = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: mergeCoordinateLists(toMerge) },
      properties: {
        name: railway.name,
        description: railway.description,
        '@id': railway.ids.join(';'),
        track_id: railway.track_id,
        railway: 'rail',
      },
    };

    mergedFeatures = [
      ...prunedFeatures.filter((f) => !railway.ids.includes(f.properties["@id"])),
      mergedRailway
    ]
  })

  fs.writeFileSync('filtered-cz.geojson', JSON.stringify({
    "type": "FeatureCollection",
    "features": mergedFeatures,
  }), 'utf8');
}); 
