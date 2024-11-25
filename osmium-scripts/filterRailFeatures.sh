#!/bin/sh

if [ $# -ne 1 ]
  then
    echo "Usage: filterRailFeatures.sh country_code"
    exit 1
fi

code="${1}"
 
osmium tags-filter \
    --overwrite \
    -o data/${code}-rail.osm.pbf \
    data/${code}.osm.pbf \
    nwr/railway \
    nwr/disused:railway \
    nwr/abandoned:railway \
    nwr/razed:railway \
    nwr/construction:railway \
    nwr/proposed:railway \
    n/public_transport=stop_position \
    nwr/public_transport=platform \
    r/route=train \
    r/route=tram \
    r/route=light_rail \
    r/route=subway
