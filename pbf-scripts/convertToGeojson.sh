#!/bin/sh

if [ $# -ne 1 ]
  then
    echo "Usage: convertPbfToGeojson.sh country_code"
    exit 1
fi

code="${1}"
osmium export data/${code}-rail.osm.pbf -a id -f geojson > data/${code}-rail.geojson
