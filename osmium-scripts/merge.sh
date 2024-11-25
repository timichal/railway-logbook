#!/bin/sh

# Sort the arguments alphabetically and store them in an array
sorted_countries=($(echo "$@" | tr ' ' '\n' | sort))

# Initialize the output file name with 'data/'
output_file="data/"

# Create the output file name by joining the sorted country codes with '-'
output_file+=$(IFS=-; echo "${sorted_countries[*]}")  # Join with '-'

# Add the suffix to the output file name
output_file+="-rail.osm.pbf"

# Initialize the osmium merge command
command="osmium merge -O -o $output_file"

# Loop through the sorted countries and add the input files to the command
for country in "${sorted_countries[@]}"; do
    command="$command data/$country-rail.osm.pbf"
done

# Execute the constructed command
eval "$command"
