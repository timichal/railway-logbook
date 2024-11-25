#!/bin/sh

if [ $# -ne 1 ]
  then
    echo "Usage: downloadAndConvertPbf.sh country_code"
    exit 1
fi

code="${1}"
case ${code} in
  "cz") filename="czech-republic-latest.osm.pbf"
  ;;
  "at") filename="austria-latest.osm.pbf"
  ;;
  *) echo "Unknown country code. Aborting"
  exit 1
  ;;
esac

curl https://download.geofabrik.de/europe/${filename} -o ${code}.osm.pbf
 
osmium tags-filter \
    -o temp.osm.pbf \
    ${code}.osm.pbf \
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

osmium export temp.osm.pbf -a id -f geojson > ${code}.geojson

rm temp.osm.pbf
