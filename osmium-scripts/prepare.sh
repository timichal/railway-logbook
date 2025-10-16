#!/bin/sh
echo "Downloading europe-250101.osm.pbf for Europe..."
curl -o "data/europe.tmp.osm.pbf" "https://download.geofabrik.de/europe-250101.osm.pbf" || {
    echo "Failed to download europe-250101.osm.pbf."
}

sh osmium-scripts/filterRailFeatures.sh europe
sh osmium-scripts/convertToGeojson.sh europe
tsx src/scripts/pruneData.ts europe
rm data/*.tmp.*
