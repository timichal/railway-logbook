#!/bin/bash

# The server half of deploy.sh: prepare every region's map data here, import
# it, and record which data went in. deploy.sh starts this detached from the
# SSH session (nohup, output to data/deploy.log), so a dropped connection does
# not kill a run that spends most of an hour downloading. Not meant to be run
# by hand, though nothing stops it - run it from anywhere, it works from the
# repository root.
#
# Flags: --valid-only and --concurrency=N go to importMapData. --fresh throws
# away whatever an earlier failed run left behind and starts from scratch.
#
# A region whose pruned file was prepared after the last successful deploy is
# reused rather than rebuilt: it was produced by a run that failed later (at
# another region, or at the import), and preparing Europe again is half an
# hour of downloads. A successful deploy leaves every pruned file older than
# its record, so the next deploy prepares everything anew.

set -e

cd "$(dirname "$0")/.."

DATA_DIR="data"
RECORD_FILE="${DATA_DIR}/deployed-extracts.txt"
STATUS_FILE="${DATA_DIR}/deploy.status"

# deploy.sh reads the exit status from here once the process is gone; a missing
# file then means the run was killed outright (out of memory, most likely).
rm -f "${STATUS_FILE}"
trap 'echo $? > "${STATUS_FILE}"' EXIT

FRESH=""
IMPORT_FLAGS=""
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=1 ;;
    --valid-only | --concurrency=*) IMPORT_FLAGS="${IMPORT_FLAGS} $arg" ;;
    *)
      echo "ERROR: Unknown argument '$arg'"
      exit 1
      ;;
  esac
done

echo "=== Map data deploy started $(date -u '+%Y-%m-%d %H:%M UTC') ($(git rev-parse --short HEAD)) ==="

if ! command -v osmium > /dev/null; then
  echo "ERROR: osmium is not installed on the server (sudo apt install osmium-tool)"
  exit 1
fi

# nvm puts node, and through npm run the local tsx, on the PATH. nvm.sh is not
# written for set -e - a probe inside it that returns non-zero would end this
# script mid-source, silently - so it is loaded without, and judged by whether
# npm turned up.
set +e
# shellcheck disable=SC1090
. ~/.nvm/nvm.sh > /dev/null 2>&1
set -e
if ! command -v npm > /dev/null; then
  echo "ERROR: npm not found after loading ~/.nvm/nvm.sh"
  exit 1
fi

REGIONS="$(sh osmium-scripts/prepare.sh --list-regions)"

if [ -n "${FRESH}" ]; then
  echo "--fresh: discarding pruned files and intermediates left by earlier runs"
  for REGION in ${REGIONS}; do
    rm -rf "${DATA_DIR}/${REGION}-extracts"
    rm -f "${DATA_DIR}/${REGION}".tmp.* "${DATA_DIR}/${REGION}-pruned.geojson" "${DATA_DIR}/${REGION}-pruned.sources"*
  done
fi

# Reused only if it is also built from exactly the extracts listed now: a
# country added to extracts.txt after the failed run would otherwise be left out
# of the data without a word.
TO_PREPARE=""
for REGION in ${REGIONS}; do
  PRUNED="${DATA_DIR}/${REGION}-pruned.geojson"
  SOURCES="${DATA_DIR}/${REGION}-pruned.sources"
  if [ -f "${PRUNED}" ] && [ -f "${SOURCES}" ] &&
    { [ ! -f "${RECORD_FILE}" ] || [ "${PRUNED}" -nt "${RECORD_FILE}" ]; } &&
    [ "$(cut -d: -f1 "${SOURCES}")" = "$(sh osmium-scripts/prepare.sh --list-extracts "${REGION}")" ]; then
    echo "Reusing ${PRUNED}, prepared $(date -u -r "${PRUNED}" '+%Y-%m-%d %H:%M UTC') and not deployed yet (--fresh rebuilds it)"
  else
    TO_PREPARE="${TO_PREPARE} ${REGION}"
  fi
done

if [ -n "${TO_PREPARE}" ]; then
  # The largest single extract (France) is ~5GB, the merged and converted
  # intermediates of a region a few more. Failing here beats failing an hour in.
  AVAILABLE_GB=$(($(df -Pk "${DATA_DIR}" | awk 'NR == 2 { print $4 }') / 1024 / 1024))
  if [ "${AVAILABLE_GB}" -lt 10 ]; then
    echo "ERROR: only ${AVAILABLE_GB}GB free on the data disk, 10GB needed"
    exit 1
  fi

  echo ""
  npm run prepareMapData -- ${TO_PREPARE}
fi

PRUNED_FILES=""
for REGION in ${REGIONS}; do
  PRUNED_FILES="${PRUNED_FILES} ${DATA_DIR}/${REGION}-pruned.geojson"
done

echo ""
# One import for every region: the tables are cleared once, before the first file.
npm run importMapData -- ${PRUNED_FILES} ${IMPORT_FLAGS}

# Recorded only now that the data is in the database. deploy.sh copies this
# into the repository as osmium-scripts/deployed-extracts.txt.
{
  echo "# The OSM data on the server: the date each Geofabrik extract was cut."
  echo "# Written by deploy.sh after a successful map data deploy."
  echo "# Deployed $(date -u '+%Y-%m-%d %H:%M UTC')"
  for REGION in ${REGIONS}; do
    echo ""
    echo "# ${REGION}"
    cat "${DATA_DIR}/${REGION}-pruned.sources"
  done
} > "${RECORD_FILE}.part"
mv "${RECORD_FILE}.part" "${RECORD_FILE}"

# Pruned files from before extracts were tracked carried the date in their name.
rm -f "${DATA_DIR}"/*-pruned-[0-9]*.geojson "${DATA_DIR}"/*-pruned-[0-9]*.geojson.gz

echo ""
echo "=== Map data deploy finished $(date -u '+%Y-%m-%d %H:%M UTC') ==="
