#!/bin/bash

# Deploy map data to remote server
# Usage: ./deploy.sh <DATE>
# Example: ./deploy.sh 251016

set -e  # Exit on error

if [ -z "$1" ]; then
  echo "Error: DATE argument required"
  echo "Usage: ./deploy.sh <DATE>"
  echo "Example: ./deploy.sh 251016"
  exit 1
fi

DATE=$1
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
