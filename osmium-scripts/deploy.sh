#!/bin/bash

# Deploy map data to remote server
# Uses the date argument if supplied (YYMMDD), otherwise previous day's date
# Pass --valid-only to skip recalculating already-invalid routes on remote import.
# Example: ./deploy.sh 260523, ./deploy.sh --valid-only, ./deploy.sh 260523 --valid-only
#
# Both regions (see src/lib/regions.ts) travel together: they share the stations
# and railway_parts tables, and the remote import clears those before loading, so
# a partial deploy would wipe the region it doesn't carry.
#
# Nothing is removed from the server until the replacement has arrived and been
# checked: the upload comes first, the archives are integrity-tested, and only
# then is the old data replaced. A transfer that dies halfway leaves the server
# exactly as it was.

set -e  # Exit on error

# Parse args: --valid-only flag (any position) + optional positional date (YYMMDD).
DATE=""
VALID_ONLY=""
for arg in "$@"; do
  case "$arg" in
    --valid-only) VALID_ONLY="--valid-only" ;;
    *) DATE="$arg" ;;
  esac
done
# Default to yesterday in YYMMDD format if no date supplied
DATE="${DATE:-$(date -d "yesterday" +%y%m%d)}"
REMOTE_HOST="railmap@railmap.zlatkovsky.cz"
REMOTE_DIR="/home/railmap/osm-trains"
REGIONS="europe japan"

# Prepare only the regions whose pruned file isn't already sitting in ./data.
# prepare.sh renames its output into place only on success, so a file being
# there means it is complete.
MISSING_REGIONS=""
for REGION in ${REGIONS}; do
  if [ ! -f "./data/${REGION}-pruned-${DATE}.geojson" ]; then
    MISSING_REGIONS="${MISSING_REGIONS} ${REGION}"
  fi
done

if [ -z "${MISSING_REGIONS}" ]; then
  echo "=== Step 1: Skipping data preparation (all pruned files for ${DATE} already exist) ==="
else
  echo "=== Step 1: Preparing map data locally (DATE: ${DATE}, regions:${MISSING_REGIONS}) ==="
  npm run prepareMapData -- "${DATE}" ${MISSING_REGIONS}
fi

echo ""
echo "=== Step 2: Gzipping pruned files locally ==="
LOCAL_ARCHIVES=""
REMOTE_ARCHIVES=""
REMOTE_FILES=""
for REGION in ${REGIONS}; do
  gzip -kf "./data/${REGION}-pruned-${DATE}.geojson"
  LOCAL_ARCHIVES="${LOCAL_ARCHIVES}./data/${REGION}-pruned-${DATE}.geojson.gz "
  REMOTE_ARCHIVES="${REMOTE_ARCHIVES}${REMOTE_DIR}/data/${REGION}-pruned-${DATE}.geojson.gz "
  REMOTE_FILES="${REMOTE_FILES}data/${REGION}-pruned-${DATE}.geojson "
done

echo ""
echo "=== Step 3: Uploading pruned files to remote server ==="
pscp ${LOCAL_ARCHIVES} "${REMOTE_HOST}:${REMOTE_DIR}/data/"

echo ""
echo "=== Step 4: Verifying the uploaded archives ==="
# gzip -t fails the CRC on a truncated or corrupted upload, and plink passes the
# remote exit status back, so set -e stops the deploy here rather than letting
# the import clear the tables and then choke on the file.
plink -batch "${REMOTE_HOST}" "gzip -t ${REMOTE_ARCHIVES}"
echo "✓ All archives intact"

echo ""
echo "=== Step 5: Replacing the old data on the remote server ==="
# Now that the replacement is known good: drop the previous uncompressed files,
# decompress this run's archives (gunzip removes the .gz as it goes), then clear
# out any archives left over from an older date.
plink -batch "${REMOTE_HOST}" "rm -f ${REMOTE_DIR}/data/*.geojson && gunzip -f ${REMOTE_ARCHIVES} && rm -f ${REMOTE_DIR}/data/*.geojson.gz"

echo ""
echo "=== Step 6: Importing map data on remote server ==="
# One import for every region: the tables are cleared once, before the first file.
plink -batch "${REMOTE_HOST}" "source ~/.nvm/nvm.sh && cd ${REMOTE_DIR} && npm run importMapData -- ${REMOTE_FILES}${VALID_ONLY}"

echo ""
echo "=== Deployment complete! ==="
