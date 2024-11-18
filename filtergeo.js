import fs from "fs";

fs.readFile('data-cz.geojson', function (err, data) {
  const col = JSON.parse(data);
  const filtered = {
    "type": "FeatureCollection",
    "features": col.features
      .filter((feat) => {
        if (feat.geometry.type === "LineString") {
          if (["rail", "narrow_gauge"].includes(feat.properties.railway) && ["main", "branch"].includes(feat.properties.usage)) return true;
          return false;
        }
        if (!["station", "halt"].includes(feat.properties.railway) || feat.properties.subway) return false;
        return true;
      })
      .map((feat) => ({
        ...feat,
        properties: Object.fromEntries(
          Object.entries(feat.properties).filter(
            ([key, val]) => ![
              "name:de", "name:ru", "alt_name:de", "uic_ref", "wikidata", "wikipedia",
              "public_transport", "train", "wheelchair", "air_conditioning", "baby_feeding", "internet_access",
              "addr:city", "addr:postcode", "addr:conscriptionnumber", "addr:country", "addr:housenumber", "addr:street",
              "addr:place",
              "website", "note", "source", "source:ele", "ref:ruian:addr",
              "source:addr", "source:name", "source:official_name", "source:ref", "source:maxspeed",
              "railway:etcs", "railway:ls", "railway:lzb", "railway:pzb", "railway:preferred_direction",
              "railway:radio", "railway:track_class", "railway:traffic_mode",
              "proposed:electrified", "proposed:frequency", "proposed:voltage",
            ].includes(key)
          )
        ),
      }))
  };
  fs.writeFileSync('filtered-cz.geojson', JSON.stringify(filtered), 'utf8');
}); 
