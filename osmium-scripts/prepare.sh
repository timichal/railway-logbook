#!/bin/sh

# OSM Railway Data Processing Pipeline
# This script downloads, filters, and converts OSM data for railway tracking.
#
# The map is built from the Geofabrik extracts listed in
# osmium-scripts/extracts.txt - Europe one per country, Japan as one - into a
# single file, data/pruned.geojson, which importMapData loads. Every extract is
# downloaded, filtered down to railways and deleted before the next arrives, so
# the disk never holds more than one raw extract; the filtered files are then
# merged and pruned. The regions (src/lib/shared/regions.ts) are bounding boxes
# applied when the data is read, so nothing here needs to know about them.
#
# Usage: prepare.sh [extract ...]
#   With no arguments, every extract listed. Otherwise only the extracts named
#   - an extract's path, or a prefix of it ending at a "/": "asia/japan" alone
#   builds a Japan-only map, "europe" every europe/ extract. For trying the
#   pipeline, or a local database, without downloading the whole list. Such a
#   map goes to data/pruned-partial.geojson instead, so it can never stand in
#   for the full one: importing it replaces the whole map, every other region
#   included.
#
# Extracts are always the latest Geofabrik has. -latest is resolved to the
# dated file it redirects to before downloading, so a download resumed after
# Geofabrik published the next day's file does not splice two files together.
# The date of the data each extract carried is written beside the output, in
# data/pruned.sources; deploy.sh turns that into
# osmium-scripts/deployed-extracts.txt.
#
# Every stage writes to a .part file and renames it only once the tool has
# exited cleanly, so "the file exists" means "the file is finished" and the
# skip-if-present checks below can trust it. Without that, interrupting osmium
# (Ctrl-C, OOM, full disk) leaves a truncated file that the next run silently
# reuses. A failed run keeps its finished extracts, so a retry picks up where
# it stopped.

set -e  # Exit on error

DATA_DIR="data"
# Overridable so the pipeline can be tried on a list of its own.
EXTRACTS_FILE="${EXTRACTS_FILE:-osmium-scripts/extracts.txt}"
GEOFABRIK="https://download.geofabrik.de"

WORK_DIR="${DATA_DIR}/extracts"
MERGED_FILE="${WORK_DIR}/merged.osh.pbf"
FILTERED_FILE="${DATA_DIR}/rail.tmp.osm.pbf"
GEOJSON_FILE="${DATA_DIR}/rail.tmp.geojson"
if [ $# -eq 0 ]; then
    OUTPUT_NAME="pruned"
else
    OUTPUT_NAME="pruned-partial"
fi
OUTPUT_FILE="${DATA_DIR}/${OUTPUT_NAME}.geojson"
SOURCES_FILE="${DATA_DIR}/${OUTPUT_NAME}.sources"
# Which extracts ${FILTERED_FILE} was merged from (see step 2).
MERGED_LIST_FILE="${FILTERED_FILE}.extracts"

if [ ! -f "${EXTRACTS_FILE}" ]; then
    echo "ERROR: ${EXTRACTS_FILE} not found (run from the repository root)"
    exit 1
fi

# The extract paths listed in extracts.txt, comments and blanks dropped. The
# \r is stripped because a Windows checkout may carry CRLF line endings.
all_extracts() {
    awk '{ sub(/\r$/, "") } /^[ \t]*#/ || NF < 1 { next } { print $1 }' "${EXTRACTS_FILE}"
}

# The listed extracts one argument selects: the path itself, or every path
# under it.
matching_extracts() {
    all_extracts | awk -v sel="${1%/}" '$0 == sel || index($0, sel "/") == 1'
}

# The date (YYYY-MM-DD) of the OSM data in a .osm.pbf, from its header. osmium
# carries the header through tags-filter, so this reads a filtered file too.
extract_date() {
    DATE="$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$1" 2>/dev/null)"
    if [ -z "${DATE}" ]; then
        DATE="$(osmium fileinfo -g header.option.timestamp "$1" 2>/dev/null)"
    fi
    echo "${DATE:-unknown}" | cut -c1-10
}

# Query mode, so remote-deploy.sh reads extracts.txt through this one parser
# instead of carrying a copy of it.
if [ "$1" = "--list-extracts" ]; then
    all_extracts
    exit 0
fi

if [ $# -eq 0 ]; then
    EXTRACTS="$(all_extracts)"
else
    # Every selected path on a line of its own, newline-bounded, so the case
    # below matches whole paths only.
    SELECTED="
"
    for SEL in "$@"; do
        MATCHED="$(matching_extracts "${SEL}")"
        if [ -z "${MATCHED}" ]; then
            echo "ERROR: '${SEL}' matches no extract listed in ${EXTRACTS_FILE}"
            exit 1
        fi
        SELECTED="${SELECTED}${MATCHED}
"
    done
    # In list order, once each, however the arguments overlap.
    EXTRACTS="$(all_extracts | while read -r EXTRACT; do
        case "${SELECTED}" in *"
${EXTRACT}
"*) echo "${EXTRACT}" ;; esac
    done)"
fi
if [ -z "${EXTRACTS}" ]; then
    echo "ERROR: ${EXTRACTS_FILE} lists no extracts"
    exit 1
fi
COUNT="$(echo "${EXTRACTS}" | wc -l | tr -d ' ')"

echo "=== Starting OSM Railway Data Processing (${COUNT} extracts) ==="
echo ""

mkdir -p "${WORK_DIR}"

# 1. Download and filter each extract. Each lives under its Geofabrik path
# (data/extracts/europe/georgia.rail.pbf), since a bare name is not unique -
# Geofabrik also has a north-america/us/georgia.
FILTERED_NOW=""
N=0
for EXTRACT in ${EXTRACTS}; do
    N=$((N + 1))
    EXTRACT_DIR="${WORK_DIR}/$(dirname "${EXTRACT}")"
    NAME="$(basename "${EXTRACT}")"
    RAIL_FILE="${WORK_DIR}/${EXTRACT}.rail.pbf"
    mkdir -p "${EXTRACT_DIR}"

    if [ -f "${RAIL_FILE}" ]; then
        echo "[1/4] (${N}/${COUNT}) ${EXTRACT}: already filtered, data from $(extract_date "${RAIL_FILE}")"
        continue
    fi

    # -latest answers with a redirect to the dated file. Where it serves the
    # file directly instead (it sometimes does, mid-publish) there is no
    # dated name to pin, and the download starts over rather than resuming.
    LATEST_URL="${GEOFABRIK}/${EXTRACT}-latest.osm.pbf"
    URL="$(curl -sfI -o /dev/null -w '%{redirect_url}' "${LATEST_URL}")" || {
        echo "ERROR: ${LATEST_URL} is not available - is '${EXTRACT}' spelled as on Geofabrik?"
        exit 1
    }
    DOWNLOAD_FILE="${EXTRACT_DIR}/$(basename "${URL:-${LATEST_URL}}")"
    # A partial download of an older dated file can never be completed now.
    for STALE in "${EXTRACT_DIR}/${NAME}"-[0-9]*.osm.pbf "${EXTRACT_DIR}/${NAME}-latest.osm.pbf"; do
        if [ "${STALE}" != "${DOWNLOAD_FILE}" ] || [ -z "${URL}" ]; then
            rm -f "${STALE}"
        fi
    done

    echo "[1/4] (${N}/${COUNT}) ${EXTRACT}: downloading $(basename "${DOWNLOAD_FILE}")..."
    # --fail keeps an HTTP error page from being written out as a .osm.pbf
    # (osmium would then fail on an "invalid BlobHeader size" that says
    # nothing about the download) and out of the file a resume appends to.
    # The progress meter is left on (no -s) so a stalled download shows as
    # a falling "Current Speed": it goes to stderr whether or not that is a
    # terminal, so it reaches deploy.log, and its frames are \r-separated,
    # so the deploy's pty redraws one line in place. After a resume its
    # totals count only the part still to fetch.
    curl --fail -S -C - -o "${DOWNLOAD_FILE}" "${URL:-${LATEST_URL}}" || {
        echo "ERROR: Failed to download $(basename "${DOWNLOAD_FILE}")"
        exit 1
    }

    echo "[1/4] (${N}/${COUNT}) ${EXTRACT}: filtering rail features..."
    # Stations are matched on nodes AND ways (nw/): plenty of them - most of
    # France, from the SNCF/cadastre import - carry railway=station on the
    # station building instead of a node. osmium export turns those closed ways
    # into (Multi)Polygons, which pruneData.ts reduces back to a Point.
    # -f pbf is explicit because the .part suffix hides the format.
    osmium tags-filter \
        --overwrite \
        -f pbf \
        -o "${RAIL_FILE}.part" \
        "${DOWNLOAD_FILE}" \
        w/railway=rail,narrow_gauge,light_rail,monorail \
        nw/railway=station,halt || {
            echo "ERROR: Failed to filter ${EXTRACT}"
            rm -f "${RAIL_FILE}.part"
            exit 1
        }
    mv "${RAIL_FILE}.part" "${RAIL_FILE}"
    rm -f "${DOWNLOAD_FILE}"
    FILTERED_NOW=1
    echo "✓ ${EXTRACT}: data from $(extract_date "${RAIL_FILE}")"
done
echo ""

# 2. Merge the extracts. Neighbouring extracts overlap at the border, and
# when they were cut on different days the same way can arrive in two
# versions - a plain merge writes both, which would give railway_parts two
# rows with one id. So they are merged as history (-H keeps every version,
# without warning about it) and time-filter then keeps the version current
# now, i.e. the newest. Run for a single extract too, to keep one path.
#
# A merged file left by a failed run is reused only if it was merged from
# exactly these extracts and none of them was filtered since: an extract
# added to extracts.txt in between would otherwise be downloaded, listed in
# .sources, and still be missing from the data. The GeoJSON is converted
# from the merged file, so it goes with it.
if [ -n "${FILTERED_NOW}" ] ||
    [ "$(cat "${MERGED_LIST_FILE}" 2>/dev/null)" != "${EXTRACTS}" ]; then
    rm -f "${FILTERED_FILE}" "${MERGED_LIST_FILE}" "${GEOJSON_FILE}"
fi
if [ -f "${FILTERED_FILE}" ]; then
    echo "[2/4] Skipping merge - ${FILTERED_FILE} already exists"
else
    echo "[2/4] Merging ${COUNT} extracts..."
    RAIL_FILES=""
    for EXTRACT in ${EXTRACTS}; do
        RAIL_FILES="${RAIL_FILES} ${WORK_DIR}/${EXTRACT}.rail.pbf"
    done
    osmium merge -H --overwrite -f osh.pbf -o "${MERGED_FILE}.part" ${RAIL_FILES} || {
        echo "ERROR: Failed to merge extracts"
        rm -f "${MERGED_FILE}.part"
        exit 1
    }
    mv "${MERGED_FILE}.part" "${MERGED_FILE}"
    osmium time-filter --overwrite -f pbf -o "${FILTERED_FILE}.part" "${MERGED_FILE}" || {
        echo "ERROR: Failed to deduplicate merged extracts"
        rm -f "${FILTERED_FILE}.part"
        exit 1
    }
    echo "${EXTRACTS}" > "${MERGED_LIST_FILE}"
    mv "${FILTERED_FILE}.part" "${FILTERED_FILE}"
    rm -f "${MERGED_FILE}"
    echo "✓ Merge complete"
fi

# Written now, while the filtered extracts are still here to read, and
# renamed into place only alongside the pruned output it describes.
for EXTRACT in ${EXTRACTS}; do
    echo "${EXTRACT}: $(extract_date "${WORK_DIR}/${EXTRACT}.rail.pbf")"
done > "${SOURCES_FILE}.part"
echo ""

# 3. Convert to GeoJSON
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
tsx src/scripts/pruneData.ts "${OUTPUT_FILE}" < "${GEOJSON_FILE}" || {
    echo "ERROR: Failed to prune data"
    exit 1
}
mv "${SOURCES_FILE}.part" "${SOURCES_FILE}"
echo "✓ Pruning complete"
echo ""

# 5. Cleanup: remove this run's intermediate files. Only reached once pruning
# succeeded, so a failed run keeps its intermediates for the retry. Only this
# run's extracts: a partial run must not take the finished extracts a failed
# full run left behind for its own retry.
echo "Cleaning up intermediate files..."
for EXTRACT in ${EXTRACTS}; do
    rm -f "${WORK_DIR}/${EXTRACT}.rail.pbf"
done
rm -f "${MERGED_FILE}"
find "${WORK_DIR}" -depth -type d -empty -exec rmdir {} \;
rm -f "${FILTERED_FILE}" "${MERGED_LIST_FILE}" "${GEOJSON_FILE}"
echo "✓ Cleanup complete"
echo ""

echo "=== OSM Railway Data Processing Complete ==="
echo "Output: ${OUTPUT_FILE}"
sed 's/^/  /' "${SOURCES_FILE}"
