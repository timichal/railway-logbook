#!/bin/sh

if [ $# -lt 1 ]
then
    echo "Usage: download.sh country_code [country_code ...]"
    exit 1
fi

for code in "$@"
do
    case ${code} in
        "cz") filename="czech-republic-latest.osm.pbf"
        ;;
        "at") filename="austria-latest.osm.pbf"
        ;;
        "li") filename="liechtenstein-latest.osm.pbf"
        ;;
        *) echo "Unknown country code: ${code}. Skipping."
        continue
        ;;
    esac

    echo "Downloading ${filename} for country code ${code}..."
    curl -o "data/${code}.tmp.osm.pbf" "https://download.geofabrik.de/europe/${filename}" || {
        echo "Failed to download ${filename} for ${code}. Continuing."
    }
done
