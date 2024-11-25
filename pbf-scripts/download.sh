#!/bin/sh

if [ $# -ne 1 ]
  then
    echo "Usage: download.sh country_code"
    exit 1
fi

code="${1}"
case ${code} in
  "cz") filename="czech-republic-latest.osm.pbf"
  ;;
  "at") filename="austria-latest.osm.pbf"
  ;;
  "li") filename="liechtenstein-latest.osm.pbf"
  ;;
  *) echo "Unknown country code. Aborting"
  exit 1
  ;;
esac

curl https://download.geofabrik.de/europe/${filename} -o data/${code}.osm.pbf
