#!/bin/sh

# OSM Railway Data Processing Pipeline
# This script downloads, filters, and converts OSM data for railway tracking

set -e  # Exit on error

# Check for required VERSION argument
if [ -z "$1" ]; then
    echo "Error: VERSION argument is required"
    echo "Usage: sh ./osmium-scripts/prepare.sh <version>"
    echo "Example: sh ./osmium-scripts/prepare.sh 251016"
    exit 1
fi

COUNTRY_CODE="europe"
DATA_DIR="data"
VERSION="$1"

echo "=== Starting OSM Railway Data Processing ==="
echo "Version: ${VERSION}"
echo ""

# Create data directory if it doesn't exist
mkdir -p "${DATA_DIR}"

# 1. Download OSM data (with resume support)
echo "[1/3] Downloading ${COUNTRY_CODE}-${VERSION}.osm.pbf..."
DOWNLOAD_FILE="${DATA_DIR}/${COUNTRY_CODE}-${VERSION}.osm.pbf"
curl -C - -o "${DOWNLOAD_FILE}" "https://download.geofabrik.de/${COUNTRY_CODE}-${VERSION}.osm.pbf" || {
    echo "ERROR: Failed to download ${COUNTRY_CODE}-${VERSION}.osm.pbf"
    exit 1
}
echo "✓ Download complete"
echo ""

# 2. Filter rail features
echo "[2/3] Filtering rail features..."
FILTERED_FILE="${DATA_DIR}/${COUNTRY_CODE}-rail.tmp.osm.pbf"
osmium tags-filter \
    --overwrite \
    -o "${FILTERED_FILE}" \
    "${DOWNLOAD_FILE}" \
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
        echo "ERROR: Failed to filter rail features"
        exit 1
    }
echo "✓ Filtering complete"
echo ""

# 3. Convert to GeoJSON and pipe directly to pruneData
echo "[3/3] Converting to GeoJSON and pruning (streaming)..."
osmium export "${FILTERED_FILE}" -a id -f geojson | tsx src/scripts/pruneData.ts ${COUNTRY_CODE} ${VERSION} || {
    echo "ERROR: Failed to convert and prune data"
    exit 1
}
echo "✓ Processing complete"
echo ""

# 4. Cleanup: remove downloaded PBF and filtered PBF
echo "Cleaning up intermediate files..."
rm -f "${DOWNLOAD_FILE}" "${FILTERED_FILE}"
echo "✓ Cleanup complete"
echo ""

echo "=== OSM Railway Data Processing Complete ==="
echo "Output: ${DATA_DIR}/${COUNTRY_CODE}-pruned-${VERSION}.geojson"
