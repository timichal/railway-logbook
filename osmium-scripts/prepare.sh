#!/bin/sh

# OSM Railway Data Processing Pipeline
# This script downloads, filters, and converts OSM data for railway tracking.
#
# The app covers two regions (see src/lib/shared/regions.ts), each built from
# the Geofabrik extracts listed for it in osmium-scripts/extracts.txt - Europe
# from one extract per country, Japan from one. Every extract is downloaded,
# filtered down to railways and deleted before the next arrives, so the disk
# never holds more than one raw extract; the filtered files are then merged
# into one per region and pruned. importMapData loads the regions together
# into the shared tables.
#
# Extracts are always the latest Geofabrik has. -latest is resolved to the
# dated file it redirects to before downloading, so a download resumed after
# Geofabrik published the next day's file does not splice two files together.
# The date of the data each extract carried is written beside the region's
# output, in data/<region>-pruned.sources; deploy.sh turns that into
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
# Overridable so the pipeline can be tried on a small list of extracts.
EXTRACTS_FILE="${EXTRACTS_FILE:-osmium-scripts/extracts.txt}"
GEOFABRIK="https://download.geofabrik.de"

if [ ! -f "${EXTRACTS_FILE}" ]; then
    echo "ERROR: ${EXTRACTS_FILE} not found (run from the repository root)"
    exit 1
fi

# The extracts.txt lines as "<region> <path>", comments and blanks dropped. The
# \r is stripped because a Windows checkout may carry CRLF line endings.
extract_lines() {
    awk '{ sub(/\r$/, "") } /^[ \t]*#/ || NF < 2 { next } { print $1, $2 }' "${EXTRACTS_FILE}"
}

# Every region, in the order extracts.txt first names it.
all_regions() {
    extract_lines | awk '!seen[$1]++ { print $1 }'
}

# The extract paths of one region.
region_extracts() {
    extract_lines | awk -v region="$1" '$1 == region { print $2 }'
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

# The names (basenames) of one region's extracts, as .sources lists them.
region_extract_names() {
    region_extracts "$1" | awk -F/ '{ print $NF }'
}

# Query modes, so remote-deploy.sh reads extracts.txt through this one parser
# instead of carrying a copy of it.
case "$1" in
    --list-regions)
        all_regions
        exit 0
        ;;
    --list-extracts)
        region_extract_names "$2"
        exit 0
        ;;
esac

# Regions to process; all of them unless named on the command line.
REGIONS="$*"
if [ -z "${REGIONS}" ]; then
    REGIONS="$(all_regions)"
fi

for REGION in ${REGIONS}; do
    if [ -z "$(region_extracts "${REGION}")" ]; then
        echo "ERROR: Unknown region '${REGION}' (no extracts listed in ${EXTRACTS_FILE})"
        exit 1
    fi
done

echo "=== Starting OSM Railway Data Processing ==="
echo "Regions: $(echo ${REGIONS})"
echo ""

mkdir -p "${DATA_DIR}"

for REGION in ${REGIONS}; do
    WORK_DIR="${DATA_DIR}/${REGION}-extracts"
    MERGED_FILE="${WORK_DIR}/merged.osh.pbf"
    FILTERED_FILE="${DATA_DIR}/${REGION}.tmp.osm.pbf"
    GEOJSON_FILE="${DATA_DIR}/${REGION}.tmp.geojson"
    SOURCES_FILE="${DATA_DIR}/${REGION}-pruned.sources"
    # Which extracts ${FILTERED_FILE} was merged from (see step 2).
    MERGED_LIST_FILE="${FILTERED_FILE}.extracts"
    EXTRACTS="$(region_extracts "${REGION}")"
    COUNT="$(echo "${EXTRACTS}" | wc -l | tr -d ' ')"

    echo "=========================================="
    echo "Region: ${REGION} (${COUNT} extracts)"
    echo "=========================================="

    mkdir -p "${WORK_DIR}"

    # 1. Download and filter each extract
    FILTERED_NOW=""
    N=0
    for EXTRACT in ${EXTRACTS}; do
        N=$((N + 1))
        NAME="$(basename "${EXTRACT}")"
        RAIL_FILE="${WORK_DIR}/${NAME}.rail.pbf"

        if [ -f "${RAIL_FILE}" ]; then
            echo "[1/4] (${N}/${COUNT}) ${NAME}: already filtered, data from $(extract_date "${RAIL_FILE}")"
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
        DOWNLOAD_FILE="${WORK_DIR}/$(basename "${URL:-${LATEST_URL}}")"
        # A partial download of an older dated file can never be completed now.
        for STALE in "${WORK_DIR}/${NAME}"-[0-9]*.osm.pbf "${WORK_DIR}/${NAME}-latest.osm.pbf"; do
            if [ "${STALE}" != "${DOWNLOAD_FILE}" ] || [ -z "${URL}" ]; then
                rm -f "${STALE}"
            fi
        done

        echo "[1/4] (${N}/${COUNT}) ${NAME}: downloading $(basename "${DOWNLOAD_FILE}")..."
        # --fail keeps an HTTP error page from being written out as a .osm.pbf
        # (osmium would then fail on an "invalid BlobHeader size" that says
        # nothing about the download) and out of the file a resume appends to.
        curl --fail -sS -C - -o "${DOWNLOAD_FILE}" "${URL:-${LATEST_URL}}" || {
            echo "ERROR: Failed to download $(basename "${DOWNLOAD_FILE}")"
            exit 1
        }

        echo "[1/4] (${N}/${COUNT}) ${NAME}: filtering rail features..."
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
                echo "ERROR: Failed to filter ${NAME}"
                rm -f "${RAIL_FILE}.part"
                exit 1
            }
        mv "${RAIL_FILE}.part" "${RAIL_FILE}"
        rm -f "${DOWNLOAD_FILE}"
        FILTERED_NOW=1
        echo "✓ ${NAME}: data from $(extract_date "${RAIL_FILE}")"
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
        [ "$(cat "${MERGED_LIST_FILE}" 2>/dev/null)" != "$(region_extract_names "${REGION}")" ]; then
        rm -f "${FILTERED_FILE}" "${MERGED_LIST_FILE}" "${GEOJSON_FILE}"
    fi
    if [ -f "${FILTERED_FILE}" ]; then
        echo "[2/4] Skipping merge - ${FILTERED_FILE} already exists"
    else
        echo "[2/4] Merging ${COUNT} extracts..."
        RAIL_FILES=""
        for EXTRACT in ${EXTRACTS}; do
            RAIL_FILES="${RAIL_FILES} ${WORK_DIR}/$(basename "${EXTRACT}").rail.pbf"
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
        region_extract_names "${REGION}" > "${MERGED_LIST_FILE}"
        mv "${FILTERED_FILE}.part" "${FILTERED_FILE}"
        rm -f "${MERGED_FILE}"
        echo "✓ Merge complete"
    fi

    # Written now, while the filtered extracts are still here to read, and
    # renamed into place only alongside the pruned output it describes.
    for EXTRACT in ${EXTRACTS}; do
        NAME="$(basename "${EXTRACT}")"
        echo "${NAME}: $(extract_date "${WORK_DIR}/${NAME}.rail.pbf")"
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
    tsx src/scripts/pruneData.ts "${REGION}" < "${GEOJSON_FILE}" || {
        echo "ERROR: Failed to prune data"
        exit 1
    }
    mv "${SOURCES_FILE}.part" "${SOURCES_FILE}"
    echo "✓ Pruning complete"
    echo ""

    # 5. Cleanup: remove all intermediate files. Only reached once pruning
    # succeeded, so a failed run keeps its intermediates for the retry.
    echo "Cleaning up intermediate files..."
    rm -rf "${WORK_DIR}"
    rm -f "${FILTERED_FILE}" "${MERGED_LIST_FILE}" "${GEOJSON_FILE}"
    echo "✓ Cleanup complete"
    echo ""
done

echo "=== OSM Railway Data Processing Complete ==="
for REGION in ${REGIONS}; do
    echo "Output: ${DATA_DIR}/${REGION}-pruned.geojson"
    sed 's/^/  /' "${DATA_DIR}/${REGION}-pruned.sources"
done
