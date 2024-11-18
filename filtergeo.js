import fs from "fs";

fs.readFile('data-cz.geojson', function (err, data) {
  const col = JSON.parse(data);
  const filtered = {
    "type": "FeatureCollection",
    "features": col.features.filter((feat) => {
      if (feat.geometry.type === "LineString") {
        if (["rail", "narrow_gauge"].includes(feat.properties.railway) && ["main", "branch"].includes(feat.properties.usage)) return true;
        return false;
      }      
      if (!["station", "halt"].includes(feat.properties.railway) || feat.properties.subway) return false;
      return true;
    })
  };
  fs.writeFileSync('filtered-cz.geojson', JSON.stringify(filtered), 'utf8');
}); 
