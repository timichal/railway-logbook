#!/bin/sh

if [ $# -lt 1 ]
then
    echo "Usage: filterRailFeatures.sh country_code [country_code ...]"
    exit 1
fi

for code in "$@"
do
    input_file="data/${code}.osm.pbf"
    output_file="data/${code}-rail.osm.pbf"

    if [ ! -f "${input_file}" ]; then
        echo "Input file ${input_file} not found for country code ${code}. Skipping."
        continue
    fi

    echo "Filtering rail features for country code ${code}..."
    osmium tags-filter \
        --overwrite \
        -o "${output_file}" \
        "${input_file}" \
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
        r/route=subway || {
            echo "Failed to filter rail features for ${code}. Continuing."
        }
done
