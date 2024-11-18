#!/bin/sh

if [ $# -ne 2 ]
  then
    echo "Usage: filterAndConvertPbf.sh input.osm.pbf output.geojson"
    exit 1
fi

osmium tags-filter \
    -o temp.osm.pbf \
    $1 \
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

osmium export temp.osm.pbf -f geojson > $2

rm temp.osm.pbf
