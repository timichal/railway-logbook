#!/bin/sh

: '
sh osmium-scripts/download.sh cz at
sh osmium-scripts/filterRailFeatures.sh cz at
sh osmium-scripts/merge.sh cz at
sh osmium-scripts/convertToGeojson.sh cz at at-cz
tsx src/scripts/pruneData.ts cz at at-cz
rm data/*.tmp.*
npm run check at-cz
npm run check at
npm run check cz
'

echo "Downloading europe-250101.osm.pbf for Europe..."
curl -o "data/europe.tmp.osm.pbf" "https://download.geofabrik.de/europe-250101.osm.pbf" || {
    echo "Failed to download europe-250101.osm.pbf."
}

sh osmium-scripts/filterRailFeatures.sh europe
sh osmium-scripts/convertToGeojson.sh europe
tsx src/scripts/pruneData.ts europe
rm data/*.tmp.*
