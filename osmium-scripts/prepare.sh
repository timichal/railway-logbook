#!/bin/sh

# OSM Railway Data Processing Pipeline
# This script downloads, filters, and converts OSM data for railway tracking.
#
# The app covers two regions (see src/lib/regions.ts). They are fetched as
# separate Geofabrik extracts and pruned into one file each; importMapData then
# loads them together into the shared tables.
#
# Every stage writes to a .part file and renames it only once the tool has
# exited cleanly, so "the file exists" means "the file is finished" and the
# skip-if-present checks below can trust it. Without that, interrupting osmium
# (Ctrl-C, OOM, full disk) leaves a truncated file that the next run silently
# reuses — and deploy.sh would ship it.

set -e  # Exit on error

# Check for required VERSION argument
if [ -z "$1" ]; then
    echo "Error: VERSION argument is required"
    echo "Usage: sh ./osmium-scripts/prepare.sh <version> [region ...]"
    echo "Example: sh ./osmium-scripts/prepare.sh 251016"
    echo "Example: sh ./osmium-scripts/prepare.sh 251016 japan"
    echo "Regions default to: europe japan"
    exit 1
fi

DATA_DIR="data"
VERSION="$1"
shift

# Regions to process; all of them unless named on the command line.
REGIONS="$*"
if [ -z "${REGIONS}" ]; then
    REGIONS="europe japan"
fi

# Path of a region's extract on download.geofabrik.de (continents sit at the
# root, countries under their continent).
geofabrik_path() {
    case "$1" in
        europe) echo "europe" ;;
        japan)  echo "asia/japan" ;;
        *)
            echo "ERROR: Unknown region '$1' (expected: europe, japan)" >&2
            exit 1
            ;;
    esac
}

echo "=== Starting OSM Railway Data Processing ==="
echo "Version: ${VERSION}"
echo "Regions: ${REGIONS}"
echo ""

# Create data directory if it doesn't exist
mkdir -p "${DATA_DIR}"

for REGION in ${REGIONS}; do
    REMOTE_PATH="$(geofabrik_path "${REGION}")"

    echo "=========================================="
    echo "Region: ${REGION}"
    echo "=========================================="

    # 1. Download OSM data (curl resumes a partial download in place, so this
    # one keeps its real name rather than a .part)
    DOWNLOAD_FILE="${DATA_DIR}/${REGION}-${VERSION}.osm.pbf"
    echo "[1/4] Downloading ${REGION}-${VERSION}.osm.pbf (curl will resume if incomplete)..."
    # --fail matters: a dated extract Geofabrik has not published yet answers
    # 404, and without it curl writes the HTML error page out as a .osm.pbf.
    # The run then gets to step 2 before failing, with osmium reporting an
    # "invalid BlobHeader size" that says nothing about the download. --fail
    # also keeps the error body out of the file, so a later resume starts at 0
    # instead of appending to it; a genuinely interrupted transfer is still left
    # in place for curl -C - to continue.
    curl --fail -C - -o "${DOWNLOAD_FILE}" "https://download.geofabrik.de/${REMOTE_PATH}-${VERSION}.osm.pbf" || {
        echo "ERROR: Failed to download ${REMOTE_PATH}-${VERSION}.osm.pbf"
        exit 1
    }
    echo "✓ Download complete"
    echo ""

    # 2. Filter rail features
    FILTERED_FILE="${DATA_DIR}/${REGION}-${VERSION}.tmp.osm.pbf"
    if [ -f "${FILTERED_FILE}" ]; then
        echo "[2/4] Skipping filtering - ${FILTERED_FILE} already exists"
    else
        echo "[2/4] Filtering rail features..."
        # Stations are matched on nodes AND ways (nw/): plenty of them - most of
        # France, from the SNCF/cadastre import - carry railway=station on the
        # station building instead of a node. osmium export turns those closed ways
        # into (Multi)Polygons, which pruneData.ts reduces back to a Point.
        # -f pbf is explicit because the .part suffix hides the format.
        osmium tags-filter \
            --overwrite \
            -f pbf \
            -o "${FILTERED_FILE}.part" \
            "${DOWNLOAD_FILE}" \
            w/railway=rail,narrow_gauge,light_rail,monorail \
            nw/railway=station,halt || {
                echo "ERROR: Failed to filter rail features"
                rm -f "${FILTERED_FILE}.part"
                exit 1
            }
        mv "${FILTERED_FILE}.part" "${FILTERED_FILE}"
        echo "✓ Filtering complete"
    fi
    echo ""

    # 3. Convert to GeoJSON
    GEOJSON_FILE="${DATA_DIR}/${REGION}-${VERSION}.tmp.geojson"
    if [ -f "${GEOJSON_FILE}" ]; then
        echo "[3/4] Skipping conversion - ${GEOJSON_FILE} already exists"
    else
        echo "[3/4] Converting to GeoJSON..."
        osmium export "${FILTERED_FILE}" -a id -f geojson -o "${GEOJSON_FILE}.part" || {
            echo "ERROR: Failed to convert to GeoJSON"
            rm -f "${GEOJSON_FILE}.part"
            exit 1
        }
        mv "${GEOJSON_FILE}.part" "${GEOJSON_FILE}"
        echo "✓ Conversion complete"
    fi
    echo ""

    # 4. Prune data (pruneData.ts does its own .part/rename on the output, and
    # fails rather than writing a short file if the input ends mid-feature)
    echo "[4/4] Pruning data (resolving station names)..."
    tsx src/scripts/pruneData.ts ${REGION} ${VERSION} < "${GEOJSON_FILE}" || {
        echo "ERROR: Failed to prune data"
        exit 1
    }
    echo "✓ Pruning complete"
    echo ""

    # 5. Cleanup: remove all temporary files. Only reached once pruning
    # succeeded, so a failed run keeps its intermediates for the retry.
    echo "Cleaning up intermediate files..."
    rm -f "${DOWNLOAD_FILE}" "${FILTERED_FILE}" "${GEOJSON_FILE}"
    echo "✓ Cleanup complete"
    echo ""
done

echo "=== OSM Railway Data Processing Complete ==="
for REGION in ${REGIONS}; do
    echo "Output: ${DATA_DIR}/${REGION}-pruned-${VERSION}.geojson"
done
