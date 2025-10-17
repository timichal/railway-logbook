#!/bin/sh

# OSM Railway Data Processing Pipeline
# This script downloads, filters, and converts OSM data for railway tracking
# All processing is done via pipes - no intermediate files!

set -e  # Exit on error

COUNTRY_CODE="czech-republic"
DATA_DIR="data"
VERSION="251016"

echo "=== Starting OSM Railway Data Processing ==="
echo ""

# Create data directory if it doesn't exist
mkdir -p "${DATA_DIR}"

# 1. Download OSM data
echo "[1/3] Downloading ${COUNTRY_CODE}-${VERSION}.osm.pbf..."
DOWNLOAD_FILE="${DATA_DIR}/${COUNTRY_CODE}-${VERSION}.osm.pbf"
if [ -f "${DOWNLOAD_FILE}" ]; then
    echo "  File already exists, skipping download"
else
    curl -o "${DOWNLOAD_FILE}" "https://download.geofabrik.de/europe/${COUNTRY_CODE}-${VERSION}.osm.pbf" || {
        echo "ERROR: Failed to download ${COUNTRY_CODE}-${VERSION}.osm.pbf"
        exit 1
    }
fi
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
