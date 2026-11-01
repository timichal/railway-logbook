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
#
# Raw cache. Where RAW_CACHE names directories for it (the server does), the
# raw extracts are kept too, and each run brings them up to date with
# Geofabrik's daily diffs (pyosmium-up-to-date) instead of downloading them
# again: a day's diff of a country is megabytes, its extract gigabytes, and
# Geofabrik asks heavy users to use them. A diff can only be applied to the
# whole extract - a filtered one is missing the untouched nodes of any way the
# diff newly tags as railway - so the cache holds the raw files, ~35GB for the
# full list. An extract the cache has no room for is downloaded and deleted
# as before, and one that cannot be updated (too old, or not from Geofabrik's
# replication) is dropped from it and downloaded whole.

set -e  # Exit on error

DATA_DIR="data"
# Overridable so the pipeline can be tried on a list of its own.
LISTED_EXTRACTS_FILE="osmium-scripts/extracts.txt"
EXTRACTS_FILE="${EXTRACTS_FILE:-${LISTED_EXTRACTS_FILE}}"
GEOFABRIK="https://download.geofabrik.de"

# The raw cache's directories, space-separated, in the order they fill:
# RAW_CACHE="data/raw /mnt/volume/osm-raw". Each may carry a cap in GB after a
# colon (data/raw:11); on the data disk none is needed, since the cache never
# fills it below DATA_DISK_RESERVE_GB. Each must already exist - one that is
# missing is skipped - and lie outside data/extracts, which --fresh empties.
# On a volume, name a directory inside its mount point, never the mount point
# itself: unmounted, the mount point is still there, an empty directory on the
# disk below, and the cache would fill that disk instead. Taken from the
# environment, else from .env. Unset, nothing is cached.
if [ -z "${RAW_CACHE+set}" ] && [ -f .env ]; then
    RAW_CACHE="$(sed -n 's/^RAW_CACHE=//p' .env | tail -n 1 | tr -d "\r\"'")"
fi
RAW_CACHE="${RAW_CACHE:-}"

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

# A header option of an OSM file, empty when it has none.
header_option() {
    osmium fileinfo -g "header.option.$2" "$1" 2> /dev/null || true
}

# The date (YYYY-MM-DD) of the OSM data in a .osm.pbf, from its header. osmium
# carries the header through tags-filter, so this reads a filtered file too.
extract_date() {
    DATE="$(header_option "$1" osmosis_replication_timestamp)"
    if [ -z "${DATE}" ]; then
        DATE="$(header_option "$1" timestamp)"
    fi
    echo "${DATE:-unknown}" | cut -c1-10
}

# What a run needs free on the data disk besides the raw cache: the largest
# extract (France) is ~5GB, the merged and converted intermediates a few more,
# and the import grows the database. remote-deploy.sh refuses to start with
# less, and the raw cache never fills the data disk below it.
DATA_DISK_RESERVE_GB=10

# Query modes, so remote-deploy.sh reads extracts.txt through this one parser
# instead of carrying a copy of it, and the reserve from here.
if [ "$1" = "--list-extracts" ]; then
    all_extracts
    exit 0
fi
if [ "$1" = "--data-disk-reserve-gb" ]; then
    echo "${DATA_DISK_RESERVE_GB}"
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

# Split a RAW_CACHE entry into C_DIR and C_CAP_MB (empty: no cap). The cap is
# what follows the last colon when that is a number, so a Windows path
# (D:/osm/raw) needs no special case; its leading zeros are dropped, or the
# shell would read it as octal. Trailing slashes are dropped too: the sweeps
# take a cached file's extract from its path relative to C_DIR, and with
# "data/raw/" every file would look unlisted and be deleted.
cache_entry() {
    C_DIR="$1"
    C_CAP_MB=""
    case "${1##*:}" in
        '' | *[!0-9]*) ;;
        *)
            if [ "${1%:*}" != "$1" ]; then
                C_DIR="${1%:*}"
                C_CAP_MB=$(($(echo "${1##*:}" | sed 's/^0*//; s/^$/0/') * 1024))
            fi
            ;;
    esac
    while [ "${C_DIR}" != "${C_DIR%/}" ] && [ -n "${C_DIR%/}" ]; do
        C_DIR="${C_DIR%/}"
    done
}

# The disk holding a directory (its mount point).
disk_of() {
    df -Pk "$1" | awk 'NR == 2 { print $6 }'
}

# The RAW_CACHE entries whose directory exists.
CACHE_ENTRIES=""
for ENTRY in ${RAW_CACHE}; do
    cache_entry "${ENTRY}"
    if [ -d "${C_DIR}" ]; then
        CACHE_ENTRIES="${CACHE_ENTRIES} ${ENTRY}"
    else
        echo "WARNING: raw cache directory ${C_DIR} does not exist - not caching there (is its volume mounted?)"
    fi
done
if [ -n "${CACHE_ENTRIES}" ] && ! command -v pyosmium-up-to-date > /dev/null; then
    echo "ERROR: RAW_CACHE is set but pyosmium-up-to-date is not installed (sudo apt install pyosmium)"
    exit 1
fi

# The cache directories, one per line.
cache_dirs() {
    for C_ENTRY in ${CACHE_ENTRIES}; do
        cache_entry "${C_ENTRY}"
        echo "${C_DIR}"
    done
}

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
#
# Extracts already in the raw cache come first, updated and filtered one by
# one, with nothing to overlap; only the rest go through the downloads.

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

# Free space in MB on the disk holding a directory.
free_mb() {
    df -Pk "$1" | awk 'NR == 2 { print int($4 / 1024) }'
}

# The first cache directory with room for a new raw extract of $1 MB: within
# its cap, and still leaving room beside it to rewrite its largest file, since
# an update writes the new copy before removing the old. On the data disk it
# also leaves DATA_DISK_RESERVE_GB free, so no cap is needed there; the rewrite
# borrows from that, happening before the merge needs it. Prints nothing when
# none has room. find and du take -H so that a cache directory which is a
# symlink is measured by what it points to.
pick_cache_dir() {
    for C_ENTRY in ${CACHE_ENTRIES}; do
        cache_entry "${C_ENTRY}"
        C_RESERVE_MB="$(find -H "${C_DIR}" -type f -name '*.osm.pbf' -exec wc -c {} + |
            awk '$2 != "total" && $1 > m { m = $1 } END { print int(m / 1048576) }')"
        [ "${C_RESERVE_MB}" -ge "$1" ] || C_RESERVE_MB="$1"
        C_RESERVE_MB=$((C_RESERVE_MB + DISK_MARGIN_MB))
        if [ "$(disk_of "${C_DIR}")" = "$(disk_of "${DATA_DIR}")" ] &&
            [ "${C_RESERVE_MB}" -lt $((DATA_DISK_RESERVE_GB * 1024)) ]; then
            C_RESERVE_MB=$((DATA_DISK_RESERVE_GB * 1024))
        fi
        [ $(($(free_mb "${C_DIR}") - $1)) -ge "${C_RESERVE_MB}" ] || continue
        if [ -n "${C_CAP_MB}" ]; then
            [ $(($(du -skH "${C_DIR}" | awk '{ print int($1 / 1024) }') + $1)) -le "${C_CAP_MB}" ] || continue
        fi
        echo "${C_DIR}"
        return 0
    done
}

# Find where an extract ("N:path", N its place on the list) downloads from,
# how big it is, and where it goes: DL_FILE, and DL_KEEP_AS, where it is kept
# in the raw cache once filtered (empty: deleted instead). Returns non-zero,
# having said why, when Geofabrik does not answer. Run in this shell, not in
# $(...), since it sets the DL_ globals.
resolve_download() {
    DL_N="${1%%:*}"
    DL_EXTRACT="${1#*:}"
    DL_SUBDIR="$(dirname "${DL_EXTRACT}")"
    DL_NAME="$(basename "${DL_EXTRACT}")"

    probe_latest "${DL_EXTRACT}" || return 1
    DL_URL="${P_URL}"
    DL_TOTAL_MB="${P_TOTAL_MB}"
    DL_LATEST_URL="${P_LATEST_URL}"
    DL_BASENAME="$(basename "${DL_URL}")"
    # Beside a partial download of this same dated file, wherever an earlier
    # run left it, so it resumes. Else into the raw cache where it has room,
    # else the work directory, to be deleted once filtered.
    DL_ROOT=""
    if [ "${DL_URL}" != "${DL_LATEST_URL}" ]; then
        for DL_CANDIDATE in "${WORK_DIR}" $(cache_dirs); do
            if [ -f "${DL_CANDIDATE}/${DL_SUBDIR}/${DL_BASENAME}" ]; then
                DL_ROOT="${DL_CANDIDATE}"
                break
            fi
        done
    fi
    if [ -z "${DL_ROOT}" ] && [ -n "${DL_TOTAL_MB}" ]; then
        DL_ROOT="$(pick_cache_dir "${DL_TOTAL_MB}")"
    fi
    DL_ROOT="${DL_ROOT:-${WORK_DIR}}"
    DL_FILE="${DL_ROOT}/${DL_SUBDIR}/${DL_BASENAME}"
    DL_KEEP_AS=""
    if [ "${DL_ROOT}" != "${WORK_DIR}" ]; then
        DL_KEEP_AS="${DL_ROOT}/${DL_EXTRACT}.osm.pbf"
    fi
    mkdir -p "${DL_ROOT}/${DL_SUBDIR}"
    # A partial download of an older dated file can never be completed now.
    for DL_CANDIDATE in "${WORK_DIR}" $(cache_dirs); do
        for DL_STALE in "${DL_CANDIDATE}/${DL_SUBDIR}/${DL_NAME}"-[0-9]*.osm.pbf \
            "${DL_CANDIDATE}/${DL_SUBDIR}/${DL_NAME}-latest.osm.pbf"; do
            if [ "${DL_STALE}" != "${DL_FILE}" ] || [ "${DL_URL}" = "${DL_LATEST_URL}" ]; then
                rm -f "${DL_STALE}"
            fi
        done
    done
}

# Whether the disk has room for the rest of the resolved download, plus the
# margin, beside what is on it now. An unknown size is taken as no room.
room_for_download() {
    DL_FREE_MB="$(free_mb "${DL_ROOT}")"
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

# What a filtered extract's .source holds: what it was filtered from - the
# dated file, or for a cached extract its replication state (raw_record) -
# then RAIL_FILTER.
source_record() {
    printf '%s\n%s\n' "$1" "${RAIL_FILTER}"
}

# What a cached raw extract holds, for its filtered file's .source: the last
# diff applied, which names the data exactly whether the file came from a
# download or an update.
raw_record() {
    printf 'replication %s' "$(header_option "$1" osmosis_replication_sequence_number)"
}

# Whether a raw file of extract $1 can be kept up to date from Geofabrik: its
# header says which diff it is at, on that extract's own replication. Checked
# before every update rather than trusted, because pyosmium-up-to-date takes a
# file with no replication URL as a planet and would apply the planet's diffs.
updatable_raw() {
    [ "$(header_option "$2" osmosis_replication_base_url)" = "${GEOFABRIK}/$1-updates" ] &&
        [ -n "$(header_option "$2" osmosis_replication_sequence_number)" ]
}

# The cached raw file of extract $1, or nothing.
cached_raw() {
    for C_ENTRY in ${CACHE_ENTRIES}; do
        cache_entry "${C_ENTRY}"
        if [ -f "${C_DIR}/$1.osm.pbf" ]; then
            echo "${C_DIR}/$1.osm.pbf"
            return 0
        fi
    done
}

# Past this many days old, a cached extract is downloaded whole instead,
# well inside pyosmium-up-to-date's own refusal at 90.
MAX_UPDATE_AGE_DAYS=60

# Bring the cached raw file of an extract up to date in place (N, extract,
# file). Where it cannot be - too old, or not from Geofabrik's replication -
# it is dropped from the cache and U_RAW is left empty, so the extract is
# downloaded whole. A failed update stops the run with the file kept as it
# was: it is far more likely a passing network or server problem than a bad
# file, and dropping it would cost a full download.
update_raw() {
    U_N="$1"
    U_EXTRACT="$2"
    U_RAW="$3"
    U_WHY=""
    U_TIMESTAMP="$(header_option "${U_RAW}" osmosis_replication_timestamp)"
    # GNU date parses the timestamp; where it can't, pyosmium's own check stands.
    U_SECS="$(date -u -d "${U_TIMESTAMP:-none}" +%s 2> /dev/null || true)"
    if ! updatable_raw "${U_EXTRACT}" "${U_RAW}"; then
        U_WHY="it has no replication state of ${GEOFABRIK}/${U_EXTRACT}-updates"
    elif [ -n "${U_SECS}" ] && [ $((($(date -u +%s) - U_SECS) / 86400)) -gt "${MAX_UPDATE_AGE_DAYS}" ]; then
        U_WHY="its data is more than ${MAX_UPDATE_AGE_DAYS} days old"
    fi
    # No room for the updated copy stops the run rather than dropping the
    # file: a download would need the same room, and the shortage is most
    # likely passing (what a failed run left).
    U_NEED_MB=$(($(wc -c < "${U_RAW}") / 1048576 + DISK_MARGIN_MB))
    U_FREE_MB="$(free_mb "$(dirname "${U_RAW}")")"
    if [ -z "${U_WHY}" ] && [ "${U_FREE_MB}" -lt "${U_NEED_MB}" ]; then
        echo "ERROR: no room to update ${U_RAW} (${U_NEED_MB} MB needed beside it, ${U_FREE_MB} MB free)"
        exit 1
    fi
    if [ -n "${U_WHY}" ]; then
        echo "[1/4] (${U_N}/${COUNT}) ${U_EXTRACT}: dropping ${U_RAW} from the cache, to download it whole: ${U_WHY}"
        rm -f "${U_RAW}"
        U_RAW=""
        return 0
    fi

    echo "[1/4] (${U_N}/${COUNT}) ${U_EXTRACT}: updating the cached extract (data from $(extract_date "${U_RAW}"))..."
    # In place: pyosmium writes the update to a temporary file beside the
    # input and renames it over the input only once it is complete (a stopped
    # run's temporary file is swept on the next). Exit 1 means it stopped at
    # its size limit with more diffs to come, so it goes again.
    U_PASSES=0
    while :; do
        U_STATUS=0
        pyosmium-up-to-date "${U_RAW}" || U_STATUS=$?
        U_PASSES=$((U_PASSES + 1))
        case "${U_STATUS}" in
            0) break ;;
            1) [ "${U_PASSES}" -lt 20 ] && continue ;;
        esac
        echo "ERROR: Failed to update ${U_RAW} (pyosmium-up-to-date exited ${U_STATUS})"
        echo "  It is kept as it was. Rerun later, or delete it to download ${U_EXTRACT} whole."
        exit 1
    done
    echo "✓ ${U_EXTRACT}: data from $(extract_date "${U_RAW}")"
}

# Filter a raw extract down to railways (N, extract, raw file, and where to
# keep the raw file in the cache - empty to delete it, or the file itself
# where it is cached already).
filter_extract() {
    F_N="$1"
    F_EXTRACT="$2"
    F_DOWNLOAD="$3"
    F_KEEP_AS="$4"
    F_RAIL_FILE="${WORK_DIR}/${F_EXTRACT}.rail.pbf"
    mkdir -p "$(dirname "${F_RAIL_FILE}")"

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
    # download is gone (or in the cache), so a .source always describes the
    # filtered file beside it, and an extract taken as current never has a
    # download left behind (only resolve_download sweeps those, and a reused
    # extract skips it). One missing - an interruption in between, or an
    # undated -latest download - only means the extract is fetched again.
    rm -f "${F_RAIL_FILE}.source"
    mv "${F_RAIL_FILE}.part" "${F_RAIL_FILE}"
    if [ -n "${F_KEEP_AS}" ] && updatable_raw "${F_EXTRACT}" "${F_DOWNLOAD}"; then
        if [ "${F_DOWNLOAD}" != "${F_KEEP_AS}" ]; then
            mv -f "${F_DOWNLOAD}" "${F_KEEP_AS}"
        fi
        source_record "$(raw_record "${F_KEEP_AS}")" > "${F_RAIL_FILE}.source"
    else
        if [ -n "${F_KEEP_AS}" ]; then
            echo "  ${F_EXTRACT}: not caching $(basename "${F_DOWNLOAD}"), which has no replication state of ${GEOFABRIK}/${F_EXTRACT}-updates"
        fi
        rm -f "${F_DOWNLOAD}"
        case "${F_DOWNLOAD}" in
            *-latest.osm.pbf) ;;
            *) source_record "$(basename "${F_DOWNLOAD}")" > "${F_RAIL_FILE}.source" ;;
        esac
    fi
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
    # The raw cache likewise, its partial downloads (europe/france-261031)
    # included.
    for C_DIR in $(cache_dirs); do
        find -H "${C_DIR}" -type f -name '*.osm.pbf' ! -name 'tmp*' | while read -r KEPT; do
            KEPT_EXTRACT="${KEPT#"${C_DIR}/"}"
            KEPT_EXTRACT="${KEPT_EXTRACT%.osm.pbf}"
            case "${KEPT_EXTRACT##*-}" in
                latest | [0-9]*) KEPT_EXTRACT="${KEPT_EXTRACT%-*}" ;;
            esac
            if ! echo "${ALL_EXTRACTS}" | grep -qxF "${KEPT_EXTRACT}"; then
                echo "Removing ${KEPT}: ${KEPT_EXTRACT} is no longer listed"
                rm -f "${KEPT}"
            fi
        done
    done
fi

# What a stopped update left: pyosmium-up-to-date's temporary copies
# (tmpXXXXXXXX-france.osm.pbf), each as big as its extract.
for C_DIR in $(cache_dirs); do
    find -H "${C_DIR}" -type f -name 'tmp*-*.osm.pbf' -exec rm -f {} +
done

# A second copy of a cached extract, in a later directory than the one
# cached_raw finds first: left when a directory was missing for a run (an
# unmounted volume) and the extract was downloaded into another meanwhile.
# It is never updated or read again.
EARLIER_DIRS=""
for C_DIR in $(cache_dirs); do
    for EARLIER in ${EARLIER_DIRS}; do
        find -H "${C_DIR}" -type f -name '*.osm.pbf' ! -name 'tmp*' | while read -r KEPT; do
            if [ -f "${EARLIER}/${KEPT#"${C_DIR}/"}" ]; then
                echo "Removing ${KEPT}: ${EARLIER}/${KEPT#"${C_DIR}/"} is the copy in use"
                rm -f "${KEPT}"
            fi
        done
    done
    EARLIER_DIRS="${EARLIER_DIRS} ${C_DIR}"
done

# The extracts still to filter, as "N:path", in the positional parameters
# (the selection arguments having been read above): those with no filtered
# file kept, and those Geofabrik has a newer file of than the one kept, or
# that were kept from another RAIL_FILTER. A cached extract is updated and,
# where that brought new data, filtered here and now.
FILTERED_NOW=""
set --
N=0
for EXTRACT in ${EXTRACTS}; do
    N=$((N + 1))
    RAIL_FILE="${WORK_DIR}/${EXTRACT}.rail.pbf"
    U_RAW="$(cached_raw "${EXTRACT}")"
    if [ -n "${U_RAW}" ]; then
        update_raw "${N}" "${EXTRACT}" "${U_RAW}"
    fi
    if [ -n "${U_RAW}" ]; then
        if [ -f "${RAIL_FILE}" ] &&
            [ "$(cat "${RAIL_FILE}.source" 2> /dev/null || true)" = "$(source_record "$(raw_record "${U_RAW}")")" ]; then
            echo "[1/4] (${N}/${COUNT}) ${EXTRACT}: no new data since it was last filtered, reusing that"
        else
            filter_extract "${N}" "${EXTRACT}" "${U_RAW}" "${U_RAW}"
        fi
        continue
    fi
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
if [ $# -gt 0 ]; then
    resolve_download "$1" || exit 1
    start_download
fi
while [ $# -gt 0 ]; do
    wait_download
    READY_N="${DL_N}"
    READY_EXTRACT="${DL_EXTRACT}"
    READY_FILE="${DL_FILE}"
    READY_KEEP_AS="${DL_KEEP_AS}"
    shift
    if [ $# -eq 0 ]; then
        filter_extract "${READY_N}" "${READY_EXTRACT}" "${READY_FILE}" "${READY_KEEP_AS}"
    elif ! resolve_download "$1"; then
        # The next extract's failure must not cost this one its download.
        filter_extract "${READY_N}" "${READY_EXTRACT}" "${READY_FILE}" "${READY_KEEP_AS}"
        exit 1
    elif room_for_download; then
        start_download
        filter_extract "${READY_N}" "${READY_EXTRACT}" "${READY_FILE}" "${READY_KEEP_AS}"
    else
        echo "[1/4] (${DL_N}/${COUNT}) ${DL_EXTRACT}: no room to download ahead (${DL_NEED_MB} MB needed, ${DL_FREE_MB} MB free), waiting for the filter"
        filter_extract "${READY_N}" "${READY_EXTRACT}" "${READY_FILE}" "${READY_KEEP_AS}"
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
