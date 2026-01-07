#!/bin/bash

# Deploy map data to remote server
# Automatically uses previous day's date in YYMMDD format
# Example: If today is 2026-01-08, uses 250107

set -e  # Exit on error

# Calculate previous day's date in YYMMDD format
DATE=$(date -d "yesterday" +%y%m%d)
REMOTE_HOST="railmap@railmap.zlatkovsky.cz"
REMOTE_DIR="/home/railmap/osm-trains"
PRUNED_FILE="europe-pruned-${DATE}.geojson"

if [ -f "./data/${PRUNED_FILE}" ]; then
  echo "=== Step 1: Skipping data preparation (${PRUNED_FILE} already exists) ==="
else
  echo "=== Step 1: Preparing map data locally (DATE: ${DATE}) ==="
  npm run prepareMapData -- "${DATE}"
fi

echo ""
echo "=== Step 2: Removing old .geojson files from remote server ==="
plink -batch "${REMOTE_HOST}" "rm ${REMOTE_DIR}/data/*.geojson"

echo ""
echo "=== Step 3: Uploading ${PRUNED_FILE} to remote server ==="
pscp "./data/${PRUNED_FILE}" "${REMOTE_HOST}:${REMOTE_DIR}/data/"

echo ""
echo "=== Step 4: Importing map data on remote server ==="
plink -batch "${REMOTE_HOST}" "source ~/.nvm/nvm.sh && cd ${REMOTE_DIR} && npm run importMapData data/${PRUNED_FILE}"

echo ""
echo "=== Deployment complete! ==="
