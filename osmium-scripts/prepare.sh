#!/bin/sh

sh osmium-scripts/download.sh cz at
sh osmium-scripts/filterRailFeatures.sh cz at
sh osmium-scripts/merge.sh cz at
sh osmium-scripts/convertToGeojson.sh cz at at-cz
tsx scripts/pruneData.ts cz at at-cz
rm data/*.tmp.*
npm run check at-cz
npm run check at
npm run check cz
