#!/bin/sh

if [ $# -ne 1 ]
  then
    echo "Usage: convertPbfToGeojson.sh country_code"
    exit 1
fi

code="${1}"
if [ ! -e "data/${code}-rail.osm.pbf" ]; then
    echo "Entry file not found."
    exit 1
fi

osmium export data/${code}-rail.osm.pbf -a id -f geojson > data/${code}-rail.geojson
