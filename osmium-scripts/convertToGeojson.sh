#!/bin/sh

if [ $# -lt 1 ]
then
    echo "Usage: convertPbfToGeojson.sh country_code [country_code ...]"
    exit 1
fi

for code in "$@"
do
    input_file="data/${code}-rail.osm.pbf"
    output_file="data/${code}-rail.geojson"

    if [ ! -f "${input_file}" ]; then
        echo "Input file ${input_file} not found for country code ${code}. Skipping."
        continue
    fi

    echo "Converting ${input_file} to GeoJSON..."
    osmium export "${input_file}" -a id -f geojson > "${output_file}" || {
        echo "Failed to convert ${input_file} to GeoJSON. Continuing."
    }
done
