#!/bin/sh

# OSM Railway Data Processing Pipeline
# This script downloads, filters, and converts OSM data for railway tracking.
#
# The map is built from the Geofabrik extracts listed in
# osmium-scripts/extracts.txt - Europe one per country, Japan as one - into a
# single file, data/pruned.geojson, which importMapData loads. Every extract is
# downloaded, filtered down to railways and deleted, the next one downloading
# while the previous is filtered, so the disk never holds more than two raw
# extracts; the filtered files are then merged and pruned. The regions
# (src/lib/shared/regions.ts) are bounding boxes applied when the data is
# read, so nothing here needs to know about them.
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
# The filtered extracts are kept from one run to the next, each with the name
# of the dated file it was filtered from and the filter it went through, and
# an extract is downloaded again only when Geofabrik has a newer file than that
# or the filter has changed. Geofabrik's countries are often days behind, so a
# daily run would otherwise fetch ~35GB to rebuild what it already has; kept,
# they take ~300MB.
#
# Every stage writes to a .part file and renames it only once the tool has
# exited cleanly, so "the file exists" means "the file is finished" and the
# skip-if-present checks below can trust it. Without that, interrupting osmium
# (Ctrl-C, OOM, full disk) leaves a truncated file that the next run silently
# reuses. A failed run's finished extracts are therefore reused by the retry,
# as anyone's are: unless Geofabrik has published a newer file since.

set -e  # Exit on error

DATA_DIR="data"
# Overridable so the pipeline can be tried on a list of its own.
LISTED_EXTRACTS_FILE="osmium-scripts/extracts.txt"
EXTRACTS_FILE="${EXTRACTS_FILE:-${LISTED_EXTRACTS_FILE}}"
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

# The extract paths listed in extracts.txt, comments and blanks dropped, and
# each once: a line listed twice would otherwise be filtered twice, the second
# time from a download the first had already deleted. The \r is stripped
# because a Windows checkout may carry CRLF line endings.
all_extracts() {
    awk '{ sub(/\r$/, "") } /^[ \t]*#/ || NF < 1 { next } !seen[$1]++ { print $1 }' "${EXTRACTS_FILE}"
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
#
# The two stages overlap: while one extract is being filtered, the next one
# downloads in the background, so osmium usually has something waiting and the
# run takes about as long as the downloads alone. That puts two raw extracts on
# the disk at once - the one being filtered and the one coming in - so the next
# download starts early only when the disk has room for the rest of it beside
# what is there; otherwise it waits for the filter, as a run without the
# overlap would. Either way it never starts before the previous download has
# finished, or a slow filter would let the downloads run ahead and pile up.

# Headroom left beside a download started early, for the filter's own output.
DISK_MARGIN_MB=1024

# The download in hand: where it is on the list, its extract, file and URL,
# its size in MB (empty when the server did not say), and curl's pid while it
# runs. Each function below keeps to its own prefix (DL_, W_, F_), since sh
# has no locals and the caller still needs the previous extract's values.
DL_N=""
DL_EXTRACT=""
DL_FILE=""
DL_URL=""
DL_TOTAL_MB=""
DL_PID=""

# A background curl ignores SIGINT (POSIX hands an asynchronous command of a
# non-interactive shell SIGINT ignored), so Ctrl+C, or any failure that ends
# the script, would leave it running on. It is stopped here instead, which
# leaves its partial file for the next run to resume.
stop_download() {
    if [ -n "${DL_PID}" ]; then
        kill "${DL_PID}" 2>/dev/null || true
        DL_PID=""
    fi
}
trap stop_download EXIT
trap 'exit 130' INT
trap 'exit 129' HUP
trap 'exit 143' TERM

# Ask Geofabrik for an extract's newest file: P_URL is the dated file -latest
# redirects to, P_TOTAL_MB its size (empty when the server did not say).
# Returns non-zero, having said why, when Geofabrik does not answer. Run in
# this shell, not in $(...), since it sets the P_ globals.
probe_latest() {
    # -latest answers with a redirect to the dated file, which -L follows, so
    # one call gives both the dated URL and its size. Where -latest serves the
    # file directly instead (it sometimes does, mid-publish) P_URL is -latest
    # itself: there is no dated name to pin, so the download starts over
    # rather than resuming, and a kept extract is never taken to match it. The
    # size is parsed from the headers because %header{} needs curl 7.84; the
    # last Content-Length is the file's, the redirect's own coming first.
    P_LATEST_URL="${GEOFABRIK}/$1-latest.osm.pbf"
    P_HEADERS="$(curl -sfIL --retry 3 -w 'url=%{url_effective}\n' "${P_LATEST_URL}")" || {
        echo "ERROR: ${P_LATEST_URL} is not available - is '$1' spelled as on Geofabrik?"
        return 1
    }
    P_URL="$(echo "${P_HEADERS}" | tr -d '\r' | awk '/^url=/ { print substr($0, 5) }')"
    P_TOTAL_MB="$(echo "${P_HEADERS}" | tr -d '\r' |
        awk 'tolower($1) == "content-length:" { mb = int($2 / 1048576) } END { print mb }')"
}

# Find where an extract ("N:path", N its place on the list) downloads from,
# and how big it is. Returns non-zero, having said why, when Geofabrik does
# not answer. Run in this shell, not in $(...), since it sets the DL_ globals.
resolve_download() {
    DL_N="${1%%:*}"
    DL_EXTRACT="${1#*:}"
    DL_DIR="${WORK_DIR}/$(dirname "${DL_EXTRACT}")"
    DL_NAME="$(basename "${DL_EXTRACT}")"
    mkdir -p "${DL_DIR}"

    probe_latest "${DL_EXTRACT}" || return 1
    DL_URL="${P_URL}"
    DL_TOTAL_MB="${P_TOTAL_MB}"
    DL_LATEST_URL="${P_LATEST_URL}"
    DL_FILE="${DL_DIR}/$(basename "${DL_URL}")"
    # A partial download of an older dated file can never be completed now.
    for DL_STALE in "${DL_DIR}/${DL_NAME}"-[0-9]*.osm.pbf "${DL_DIR}/${DL_NAME}-latest.osm.pbf"; do
        if [ "${DL_STALE}" != "${DL_FILE}" ] || [ "${DL_URL}" = "${DL_LATEST_URL}" ]; then
            rm -f "${DL_STALE}"
        fi
    done
}

# Whether the disk has room for the rest of the resolved download, plus the
# margin, beside what is on it now. An unknown size is taken as no room.
room_for_download() {
    DL_FREE_MB=$(($(df -Pk "${WORK_DIR}" | awk 'NR == 2 { print $4 }') / 1024))
    DL_NEED_MB="?"
    [ -n "${DL_TOTAL_MB}" ] || return 1
    DL_HAVE_MB=0
    if [ -f "${DL_FILE}" ]; then
        DL_HAVE_MB=$(($(wc -c < "${DL_FILE}") / 1048576))
    fi
    DL_NEED_MB=$((DL_TOTAL_MB - DL_HAVE_MB + DISK_MARGIN_MB))
    [ "${DL_NEED_MB}" -le "${DL_FREE_MB}" ]
}

# Start the resolved download in the background.
start_download() {
    echo "[1/4] (${DL_N}/${COUNT}) ${DL_EXTRACT}: downloading $(basename "${DL_FILE}")${DL_TOTAL_MB:+ (${DL_TOTAL_MB} MB)}..."
    # --fail keeps an HTTP error page from being written out as a .osm.pbf
    # (osmium would then fail on an "invalid BlobHeader size" that says
    # nothing about the download) and out of the file a resume appends to.
    # Silent but for errors (-sS): the progress meter would be drawn over
    # osmium's while the two run side by side. wait_download draws one
    # instead, for the time the filter is actually kept waiting.
    curl --fail -sS -C - -o "${DL_FILE}" "${DL_URL}" &
    DL_PID=$!
}

# Wait for the download in flight to finish. While it runs, the size of the
# file so far is redrawn on one line, so a stalled download shows as a number
# that stops moving: \r-separated, so the deploy's pty redraws it in place.
# kill -0 stops answering once curl has exited, the shell reaping it while it
# waits on the sleep.
wait_download() {
    W_WAITED=""
    while kill -0 "${DL_PID}" 2>/dev/null; do
        if [ -f "${DL_FILE}" ]; then
            printf '\r  %s: %d%s MB downloaded ' "${DL_EXTRACT}" \
                "$(($(wc -c < "${DL_FILE}") / 1048576))" "${DL_TOTAL_MB:+ of ${DL_TOTAL_MB}}"
            W_WAITED=1
        fi
        sleep 5
    done
    [ -z "${W_WAITED}" ] || echo ""
    wait "${DL_PID}" || {
        DL_PID=""
        echo "ERROR: Failed to download $(basename "${DL_FILE}")"
        exit 1
    }
    DL_PID=""
}

# What tags-filter keeps (see filter_extract), as its expressions separated by
# spaces. Recorded with every filtered extract, so a change here refilters the
# kept ones instead of mixing two filters in one map.
RAIL_FILTER="w/railway=rail,narrow_gauge,light_rail,monorail nw/railway=station,halt"

# What a filtered extract's .source holds: the dated file it was filtered from,
# then RAIL_FILTER.
source_record() {
    printf '%s\n%s\n' "$1" "${RAIL_FILTER}"
}

# Filter a downloaded extract down to railways and delete the download.
filter_extract() {
    F_N="$1"
    F_EXTRACT="$2"
    F_DOWNLOAD="$3"
    F_RAIL_FILE="${WORK_DIR}/${F_EXTRACT}.rail.pbf"

    echo "[1/4] (${F_N}/${COUNT}) ${F_EXTRACT}: filtering rail features..."
    # Stations are matched on nodes AND ways (nw/): plenty of them - most of
    # France, from the SNCF/cadastre import - carry railway=station on the
    # station building instead of a node. osmium export turns those closed ways
    # into (Multi)Polygons, which pruneData.ts reduces back to a Point.
    # -f pbf is explicit because the .part suffix hides the format.
    # RAIL_FILTER is unquoted on purpose: one argument per expression.
    # shellcheck disable=SC2086
    osmium tags-filter \
        --overwrite \
        -f pbf \
        -o "${F_RAIL_FILE}.part" \
        "${F_DOWNLOAD}" \
        ${RAIL_FILTER} || {
            echo "ERROR: Failed to filter ${F_EXTRACT}"
            rm -f "${F_RAIL_FILE}.part"
            exit 1
        }
    # Its .source is removed before the rename and written only after the
    # download is gone, so a .source always describes the filtered file beside
    # it, and an extract taken as current never has a download left behind
    # (only resolve_download sweeps those, and a reused extract skips it). One
    # missing - an interruption in between, or an undated -latest download -
    # only means the extract is fetched again.
    rm -f "${F_RAIL_FILE}.source"
    mv "${F_RAIL_FILE}.part" "${F_RAIL_FILE}"
    rm -f "${F_DOWNLOAD}"
    case "${F_DOWNLOAD}" in
        *-latest.osm.pbf) ;;
        *) source_record "$(basename "${F_DOWNLOAD}")" > "${F_RAIL_FILE}.source" ;;
    esac
    FILTERED_NOW=1
    echo "✓ ${F_EXTRACT}: data from $(extract_date "${F_RAIL_FILE}")"
}

# Filtered extracts are kept from run to run; one no longer listed in
# extracts.txt would only take up room. Against the whole list, not this run's
# selection, so a partial run leaves the other extracts alone - and not at all
# when the list is a trial one of its own (EXTRACTS_FILE), which would
# otherwise cost the next real run every extract it leaves out.
if [ "${EXTRACTS_FILE}" = "${LISTED_EXTRACTS_FILE}" ]; then
    ALL_EXTRACTS="$(all_extracts)"
    find "${WORK_DIR}" -type f -name '*.rail.pbf' | while read -r KEPT; do
        KEPT_EXTRACT="${KEPT#"${WORK_DIR}/"}"
        KEPT_EXTRACT="${KEPT_EXTRACT%.rail.pbf}"
        if ! echo "${ALL_EXTRACTS}" | grep -qxF "${KEPT_EXTRACT}"; then
            echo "Removing ${KEPT}: ${KEPT_EXTRACT} is no longer listed"
            rm -f "${KEPT}" "${KEPT}.source"
        fi
    done
fi

# The extracts still to filter, as "N:path", in the positional parameters
# (the selection arguments having been read above): those with no filtered
# file kept, and those Geofabrik has a newer file of than the one kept, or
# that were kept from another RAIL_FILTER.
set --
N=0
for EXTRACT in ${EXTRACTS}; do
    N=$((N + 1))
    RAIL_FILE="${WORK_DIR}/${EXTRACT}.rail.pbf"
    if [ ! -f "${RAIL_FILE}" ]; then
        set -- "$@" "${N}:${EXTRACT}"
        continue
    fi
    probe_latest "${EXTRACT}" || exit 1
    LATEST_NAME="$(basename "${P_URL}")"
    KEPT_RECORD="$(cat "${RAIL_FILE}.source" 2>/dev/null || true)"
    KEPT_NAME="$(echo "${KEPT_RECORD}" | head -n 1)"
    if [ -n "${KEPT_RECORD}" ] && [ "${KEPT_RECORD}" = "$(source_record "${LATEST_NAME}")" ]; then
        echo "[1/4] (${N}/${COUNT}) ${EXTRACT}: no newer extract than ${KEPT_NAME}, reusing it (data from $(extract_date "${RAIL_FILE}"))"
    elif [ -n "${KEPT_NAME}" ] && [ "${KEPT_NAME}" = "${LATEST_NAME}" ]; then
        echo "[1/4] (${N}/${COUNT}) ${EXTRACT}: kept ${KEPT_NAME} went through another filter - fetching it again"
        set -- "$@" "${N}:${EXTRACT}"
    else
        echo "[1/4] (${N}/${COUNT}) ${EXTRACT}: Geofabrik has ${LATEST_NAME}, kept ${KEPT_NAME:-an unknown file} - fetching it again"
        set -- "$@" "${N}:${EXTRACT}"
    fi
done

# The head of the list is always the extract downloading: each pass waits for
# it, starts the next one where there is room, and filters it.
FILTERED_NOW=""
if [ $# -gt 0 ]; then
    resolve_download "$1" || exit 1
    start_download
fi
while [ $# -gt 0 ]; do
    wait_download
    READY_N="${DL_N}"
    READY_EXTRACT="${DL_EXTRACT}"
    READY_FILE="${DL_FILE}"
    shift
    if [ $# -eq 0 ]; then
        filter_extract "${READY_N}" "${READY_EXTRACT}" "${READY_FILE}"
    elif ! resolve_download "$1"; then
        # The next extract's failure must not cost this one its download.
        filter_extract "${READY_N}" "${READY_EXTRACT}" "${READY_FILE}"
        exit 1
    elif room_for_download; then
        start_download
        filter_extract "${READY_N}" "${READY_EXTRACT}" "${READY_FILE}"
    else
        echo "[1/4] (${DL_N}/${COUNT}) ${DL_EXTRACT}: no room to download ahead (${DL_NEED_MB} MB needed, ${DL_FREE_MB} MB free), waiting for the filter"
        filter_extract "${READY_N}" "${READY_EXTRACT}" "${READY_FILE}"
        start_download
    fi
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
# succeeded, so a failed run keeps its intermediates for the retry. The
# filtered extracts stay, for the next run to reuse (see step 1).
echo "Cleaning up intermediate files..."
rm -f "${MERGED_FILE}"
find "${WORK_DIR}" -depth -type d -empty -exec rmdir {} \;
rm -f "${FILTERED_FILE}" "${MERGED_LIST_FILE}" "${GEOJSON_FILE}"
echo "✓ Cleanup complete"
echo ""

echo "=== OSM Railway Data Processing Complete ==="
echo "Output: ${OUTPUT_FILE}"
sed 's/^/  /' "${SOURCES_FILE}"
