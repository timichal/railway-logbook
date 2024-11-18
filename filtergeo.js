import fs from "fs";


function mergeCoordinateLists(lists) {
  let merged = [];  // This will hold the final merged list
  let remainingLists = [...lists];  // Clone the input lists

  // Find the first list that doesn't match the end of any other list
  let firstListIndex = remainingLists.findIndex(list => {
      return !remainingLists.some(otherList => {
          return list !== otherList &&
              list[0][0] === otherList[otherList.length - 1][0] &&
              list[0][1] === otherList[otherList.length - 1][1];
      });
  });

  // Start with the first list
  merged = remainingLists.splice(firstListIndex, 1)[0];

  // Merge the rest of the lists
  while (remainingLists.length > 0) {
      for (let i = 0; i < remainingLists.length; i++) {
          const lastCoord = merged[merged.length - 1];
          const firstCoord = remainingLists[i][0];

          // If the last coordinate of the merged list matches the first of the current list
          if (lastCoord[0] === firstCoord[0] && lastCoord[1] === firstCoord[1]) {
              // Append the rest of the current list to the merged list, excluding the matching coordinate
              merged = merged.concat(remainingLists[i].slice(1));
              // Remove the current list from remaining lists
              remainingLists.splice(i, 1);
              break;
          }
      }
  }

  return merged;
}

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
        if (["rail", "narrow_gauge"].includes(feat.properties.railway) && ["main", "branch"].includes(feat.properties.usage)) return true;
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

  const mergeData = [
    {
      ids: [
        367350208,
        315008060,
        252783358,
        252783357,
        315005906,
        298516939,
        366925192,
        1156795257,
        366925191,
        314996256,
        293182648,
        314996258,
        367350210,
        367350212,
        225138543,
        367350214,
        225138542,
        823142753,
        367350218,
        995330494,
        995330495,
        344954201,
        22898274,
        344954200,
        314996262,
        314996264,
        315005888,
        314996266,
        293182637,
        315005886,
        314996267,
        298516941,
        314999779,
        315005885,
        315005884,
        366925179,
        22901364,
        366940375,
        31970727,
        31970726,
        314999781,
        344954193,
        314996272,
        344954194,
        344954191,
        314999785,
        315005898,
        367350231,
        366940377,
        1144182016,
        366940376,
        366940379,
        22898419,
        1144182015,
        366940378,
        22899947,
        315005895,
        315005893,
        344954184,
        344954185,
        366925189,
        366925188,
        344954189,
        366925187,
        366925186,
        366925185,
        366925184,
        366925183,
        344954182,
        366925182,
        366925181,
        314996285,
        202170394,
        1240792073,
        366925190,
        315005900,
        1240792072,
        293182658,
        202170397,
        315005903,
        367350224,
        293182650,
        367350228
      ],
    }
  ];


  const toMerge = prunedFeatures
    .filter((f) => mergeData[0].ids.includes(f.properties["@id"]))
    .map((f) => f.geometry.coordinates);
    console.log(JSON.stringify(toMerge))
  const obj = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: mergeCoordinateLists(toMerge) },
    properties: { '@id': mergeData[0].ids.join(';'), railway: 'rail' },
  };
  const mergedFeatures = [
    ...prunedFeatures.filter((f) => !mergeData[0].ids.includes(f.properties["@id"])),
    obj
  ]

  fs.writeFileSync('filtered-cz.geojson', JSON.stringify({
    "type": "FeatureCollection",
    "features": mergedFeatures,
  }), 'utf8');
}); 
