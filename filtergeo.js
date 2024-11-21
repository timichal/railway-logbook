import fs from "fs";
import railwayData, { usageDict } from "./railwayData.js";
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
    }));

  const ids = prunedFeatures.map((feat) => feat.properties["@id"]);
  if (ids.length !== new Set(ids).size) {
    console.error('There are duplicate IDs in the pruned list! Cannot continue.');
    process.exit(1);
  }

  const trackPartCount = new Map();
  let mergedFeatures = prunedFeatures;
  console.log(`Total railways: ${railwayData.length}`);
  railwayData.forEach((railway, index) => {
    console.log(`Processing: ${index + 1}/${railwayData.length}: ${railway.local_number} ${railway.from} - ${railway.to}`)
    const wayIds = railway.ways.split(";").map(Number);
    const coordinatesToMerge = mergedFeatures
      .filter((f) => railway.ways.split(";").map(Number).includes(f.properties["@id"]))
      .map((f) => f.geometry.coordinates);

    const trackKey = `cz${railway.local_number}`
    trackPartCount.set(trackKey, (trackPartCount.get(trackKey) || 0) + 1);

    const mergedRailway = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: mergeCoordinateLists(coordinatesToMerge) },
      properties: {
        name: `Trať ${railway.local_number}: ${railway.from} – ${railway.to}`,
        description: `${railway.usage.split(";").map((entry) => usageDict[entry]).join(", ")}, ${railway.operator}`,
        // '@id': railway.ways,
        track_id: `cz${railway.local_number}${String.fromCharCode(96 + trackPartCount.get(trackKey))}`,
        railway: 'rail',
      },
    };

    mergedFeatures = [
      ...mergedFeatures.filter((f) => !wayIds.includes(f.properties["@id"])),
      mergedRailway
    ]
  });

  fs.writeFileSync('filtered-cz.geojson', JSON.stringify({
    "type": "FeatureCollection",
    "features": mergedFeatures,
  }), 'utf8');

  const mergedOnly = mergedFeatures.filter((feat) => {
    if (feat.geometry.type === "LineString" && !feat.properties.track_id) {
      return false;
    }
    return true;
  });

  fs.writeFileSync('merged-only-cz.geojson', JSON.stringify({
    "type": "FeatureCollection",
    "features": mergedOnly,
  }), 'utf8');
}); 
