#!/bin/sh

sh osmium-scripts/download.sh cz at
sh osmium-scripts/filterRailFeatures.sh cz at
sh osmium-scripts/merge.sh cz at
sh osmium-scripts/convertToGeojson.sh cz at at-cz
tsx pruneData.ts cz at at-cz
rm data/*.tmp.*
