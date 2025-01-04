#!/bin/sh

if [ $# -lt 1 ]
then
    echo "Usage: download.sh country_code [country_code ...]"
    exit 1
fi

for code in "$@"
do
    case ${code} in
        "cz") filename="czech-republic"
        ;;
        "at") filename="austria"
        ;;
        "li") filename="liechtenstein"
        ;;
        *) echo "Unknown country code: ${code}. Skipping."
        continue
        ;;
    esac

    echo "Downloading ${filename}-250101.osm.pbf for country code ${code}..."
    curl -o "data/${code}.tmp.osm.pbf" "https://download.geofabrik.de/europe/${filename}-250101.osm.pbf" || {
        echo "Failed to download ${filename}-250101.osm.pbf for ${code}. Continuing."
    }
done
