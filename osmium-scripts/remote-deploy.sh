#!/bin/bash

# The server half of deploy.sh: prepare every region's map data here, import
# it, and record which data went in. deploy.sh drives it through four modes:
#
#   --start [flags]  start a deploy, then follow it (as --follow)
#   --follow         print the log of the deploy in progress as it grows, or
#                    the last one's log if none is running
#   --state          print none | running | killed | <exit status of the last>
#   --run [flags]    the deploy itself; --start runs this in the background
#
# Ending the follow stops the deploy, however it ends: a SIGINT (a Ctrl+C that
# reached the pty), or the hangup when the connection goes - which is what a
# local Ctrl+C actually produces, since Windows plink takes Ctrl+C as a signal
# to quit rather than sending it on as a keystroke, even with -t. Stopping on
# the hangup is the one reading of "Ctrl+C stops it" that does not depend on
# how the local console delivers the key; the price is that a dropped
# connection stops the deploy too, and a rerun resumes from what it finished
# (filtered extracts, downloads, pruned regions).
#
# The job itself runs in a session of its own (setsid), so the stop is always
# this script's decision rather than a side effect of the hangup, and the job's
# pid is its process group id - which is what lets one kill reach curl, osmium,
# npm and node together.
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

SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT")/.."

DATA_DIR="data"
RECORD_FILE="${DATA_DIR}/deployed-extracts.txt"
STATUS_FILE="${DATA_DIR}/deploy.status"
LOG_FILE="${DATA_DIR}/deploy.log"
PID_FILE="${DATA_DIR}/deploy.pid"

# The exit status of a stopped deploy, as its TERM trap and stop_deploy record it.
STOPPED_STATUS=143

# The pid file outlives its process, and a pid is eventually handed to
# something else, so the process must also still be this script - a bare
# kill -0 would one day block every deploy on an unrelated process.
is_running() {
  [ -f "${PID_FILE}" ] && grep -qs remote-deploy.sh "/proc/$(cat "${PID_FILE}")/cmdline"
}

# The job being followed, set before anything can interrupt the follow, and
# the tail showing its log.
JOB_PID=""
TAIL_PID=""

# Runs on SIGINT, SIGHUP or SIGTERM to the follower. Nothing here may stop it
# halfway: after a hangup the terminal is gone and every echo fails, so set -e
# is off and the messages are best effort.
stop_deploy() {
  set +e
  trap '' INT HUP TERM
  # $! covers a signal landing between --start's fork and the assignment.
  local pid="${JOB_PID:-$!}"
  if [ -z "${pid}" ]; then
    exit 130
  fi
  echo "" 2> /dev/null
  echo "=== Interrupted - stopping the deploy on the server ===" 2> /dev/null
  kill -TERM -- "-${pid}" 2> /dev/null
  # The whole group, not just its leader: the script can be gone while a node
  # or osmium it started is still winding down, and that one gets the KILL too.
  for _ in $(seq 20); do
    kill -0 -- "-${pid}" 2> /dev/null || break
    sleep 0.5
  done
  if kill -0 -- "-${pid}" 2> /dev/null; then
    # A KILLed script writes no status, which --state would read as having
    # died on its own (out of memory); this was a stop.
    [ -f "${STATUS_FILE}" ] || echo "${STOPPED_STATUS}" > "${STATUS_FILE}"
    kill -KILL -- "-${pid}" 2> /dev/null
  fi
  echo "Stopped. Rerun to continue; finished extracts and downloads are kept." 2> /dev/null
  [ -z "${TAIL_PID}" ] || kill "${TAIL_PID}" 2> /dev/null
  exit 130
}

follow() {
  if ! is_running; then
    cat "${LOG_FILE}" 2> /dev/null || true
    return 0
  fi
  JOB_PID="$(cat "${PID_FILE}")"
  # tail runs in the background while this shell waits for it, because bash
  # holds a trap back until a foreground command finishes, and a wait is the
  # one thing a trapped signal cuts short. A foreground tail left the stop
  # pending for as long as tail ran - and after a hangup tail need not stop at
  # all: the signal goes to the session leader, and tail carries on past the
  # failed writes to the dead terminal.
  tail -n +1 -f --pid="${JOB_PID}" "${LOG_FILE}" &
  TAIL_PID=$!
  wait "${TAIL_PID}" || true
}

MODE="$1"
shift || true
case "${MODE}" in
  --start)
    # Before the fork, so there is no moment in which an interrupt would end
    # this script and leave the job it just started running unwatched.
    trap stop_deploy INT HUP TERM
    if is_running; then
      echo "ERROR: a deploy is already running (pid $(cat "${PID_FILE}"))"
      exit 1
    fi
    mkdir -p "${DATA_DIR}"
    rm -f "${STATUS_FILE}"
    # Emptied here rather than by the job's redirection, which happens in the
    # child: tail could otherwise open the log first and print the previous
    # deploy's (or, on a first deploy, find no file and give up).
    : > "${LOG_FILE}"
    setsid bash "${SCRIPT}" --run "$@" >> "${LOG_FILE}" 2>&1 < /dev/null &
    JOB_PID=$!
    echo "${JOB_PID}" > "${PID_FILE}"
    follow
    exit 0
    ;;
  --follow)
    trap stop_deploy INT HUP TERM
    follow
    exit 0
    ;;
  --state)
    if [ ! -f "${PID_FILE}" ]; then
      echo none
    elif is_running; then
      echo running
    elif [ -f "${STATUS_FILE}" ]; then
      cat "${STATUS_FILE}"
    else
      echo killed
    fi
    exit 0
    ;;
  --run) ;;
  *)
    echo "Usage: remote-deploy.sh --start [flags] | --follow | --state | --run [flags]"
    exit 1
    ;;
esac

# From here on: the deploy itself (--run). It sits in a session of its own
# with no terminal, so the only signal it gets is stop_deploy's TERM.

# deploy.sh reads the exit status from here once the process is gone; a missing
# file then means the run was killed outright (out of memory, most likely). The
# TERM trap turns a stop into an ordinary exit, so it is recorded too.
trap 'echo $? > "${STATUS_FILE}"' EXIT
trap 'exit ${STOPPED_STATUS}' TERM

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
