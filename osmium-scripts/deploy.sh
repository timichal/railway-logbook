#!/bin/bash

# Deploy map data to remote server
# Uses the date argument if supplied (YYMMDD), otherwise previous day's date
# Example: ./deploy.sh 260523, or with no arg defaults to yesterday

set -e  # Exit on error

# Use supplied date arg, or default to yesterday in YYMMDD format
DATE="${1:-$(date -d "yesterday" +%y%m%d)}"
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
echo "=== Step 2: Gzipping ${PRUNED_FILE} locally ==="
gzip -kf "./data/${PRUNED_FILE}"

echo ""
echo "=== Step 3: Removing old .geojson and .geojson.gz files from remote server ==="
plink -batch "${REMOTE_HOST}" "rm -f ${REMOTE_DIR}/data/*.geojson ${REMOTE_DIR}/data/*.geojson.gz"

echo ""
echo "=== Step 4: Uploading ${PRUNED_FILE}.gz to remote server ==="
pscp "./data/${PRUNED_FILE}.gz" "${REMOTE_HOST}:${REMOTE_DIR}/data/"

echo ""
echo "=== Step 5: Decompressing on remote server ==="
plink -batch "${REMOTE_HOST}" "gunzip -f ${REMOTE_DIR}/data/${PRUNED_FILE}.gz"

echo ""
echo "=== Step 6: Importing map data on remote server ==="
plink -batch "${REMOTE_HOST}" "source ~/.nvm/nvm.sh && cd ${REMOTE_DIR} && npm run importMapData data/${PRUNED_FILE}"

echo ""
echo "=== Deployment complete! ==="
