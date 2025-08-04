#!/bin/bash

sorted_countries=($(echo "$@" | tr ' ' '\n' | sort))

output_file="data/"
output_file+=$(IFS=-; echo "${sorted_countries[*]}")  # Join with '-'
output_file+="-rail.tmp.osm.pbf"

command="osmium merge -O -o $output_file"

echo "Merging codes $(IFS=" "; echo "${sorted_countries[*]}") into $output_file..."

for country in "${sorted_countries[@]}"; do
    command="$command data/$country-rail.tmp.osm.pbf"
done

eval "$command"
