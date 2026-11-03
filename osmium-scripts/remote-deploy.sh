#!/bin/bash

# The server half of deploy.sh: prepare the map data here, import it, and
# record which data went in (data/deployed-extracts.txt, the date each extract
# was cut). deploy.sh drives it through five modes:
#
#   --check [flags]  what a deploy now would bring, for deploy.sh to show
#                    before it asks to go ahead (see check below)
#   --start [flags]  start a deploy, then follow it (as --follow)
#   --follow         print the log of the deploy in progress as it grows, or
#                    the last one's log if none is running
#   --state          print none | running | killed | unchanged (the last run
#                    found nothing new to deploy) | <exit status of the last>
#   --run [flags]    the deploy itself; --start runs this in the background
#
# Ending the follow stops the deploy, however it ends: a SIGINT (a Ctrl+C that
# reached the pty), or the hangup when the connection goes - which is what a
# local Ctrl+C actually produces, since Windows plink takes Ctrl+C as a signal
# to quit rather than sending it on as a keystroke, even with -t. Stopping on
# the hangup is the one reading of "Ctrl+C stops it" that does not depend on
# how the local console delivers the key; the price is that a dropped
# connection stops the deploy too, and a rerun resumes from what it finished
# (filtered extracts, downloads, the pruned map).
#
# The job itself runs in a session of its own (setsid), so the stop is always
# this script's decision rather than a side effect of the hangup, and the job's
# pid is its process group id - which is what lets one kill reach curl, osmium,
# npm and node together.
#
# Nothing new, nothing done: the run stops once the extracts are checked if
# every one is exactly what the deployed map was built from (prepare.sh,
# DEPLOYED_INPUTS), and so is the code that prepares and imports it. The map
# would come out the same, and the import would spend half an hour
# recalculating every route for no change. --force deploys anyway; a route
# check alone is npm run verifyRouteData. A forced run that does not finish
# leaves FORCE_FILE behind, so its rerun is forced too: otherwise a plain
# "rerun to continue" would find nothing new and leave the old map in place.
# importMapData drops the record of what was deployed as it starts, since
# any import, this one or one by hand, replaces the map it describes.
#
# Flags: --valid-only and --concurrency=N go to importMapData. --fresh throws
# away whatever earlier runs left behind - a failed run's pruned map, and the
# filtered extracts every run keeps - and starts from scratch. It leaves the
# raw cache (RAW_CACHE, see prepare.sh): every file there is checked as it is
# updated, and emptying it would cost ~35GB of downloads. It implies --force,
# since starting over is for when the deployed map is in doubt.
#
# A pruned file prepared after the last successful deploy is reused rather
# than rebuilt: it was produced by a run that failed later, at the import, and
# preparing it again is half an hour of downloads. A successful deploy deletes
# the pruned file (and a file older than the record is never reused), so the
# next deploy prepares anew.

set -e

SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SCRIPT")/.."

DATA_DIR="data"
RECORD_FILE="${DATA_DIR}/deployed-extracts.txt"
# Exactly which file or diff of each extract the deployed map was built from
# (prepare.sh's .inputs), to tell whether there is anything new.
DEPLOYED_INPUTS_FILE="${DATA_DIR}/deployed-extracts.inputs"
FORCE_FILE="${DATA_DIR}/deploy.force"
STATUS_FILE="${DATA_DIR}/deploy.status"
LOG_FILE="${DATA_DIR}/deploy.log"
PID_FILE="${DATA_DIR}/deploy.pid"
PRUNED="${DATA_DIR}/pruned.geojson"
SOURCES="${DATA_DIR}/pruned.sources"
INPUTS="${DATA_DIR}/pruned.inputs"

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

# Whether a run imports the pruned file an earlier one left (see the top)
# rather than preparing a new one: prepared since the last successful deploy,
# and from exactly the extracts listed now - a country added to extracts.txt
# after the failed run would otherwise be left out of the data without a word.
reusable_pruned() {
  [ -f "${PRUNED}" ] && [ -f "${SOURCES}" ] &&
    { [ ! -f "${RECORD_FILE}" ] || [ "${PRUNED}" -nt "${RECORD_FILE}" ]; } &&
    [ "$(cut -d: -f1 "${SOURCES}")" = "$(sh osmium-scripts/prepare.sh --list-extracts)" ]
}

# The flags --check and --run take (see the top): FRESH, FORCE, and the
# import's own flags in IMPORT_FLAGS. One parser for both, so a flag added to
# the run is never refused by the check that comes before it.
FRESH=""
FORCE=""
IMPORT_FLAGS=""
parse_flags() {
  for arg in "$@"; do
    case "$arg" in
      --fresh) FRESH=1 FORCE=1 ;;
      --force) FORCE=1 ;;
      --valid-only | --concurrency=*) IMPORT_FLAGS="${IMPORT_FLAGS} $arg" ;;
      *)
        echo "ERROR: Unknown argument '$arg'"
        exit 1
        ;;
    esac
  done
}

# --check: what a deploy now would bring. Each extract's date in the deployed
# map beside the date a run would build it from ("unchanged" when it is the
# same data), whether the code that prepares and imports the map changed, and,
# on the last line, the verdict deploy.sh acts on: "new", or "unchanged" when
# a run would find nothing new. Nothing is downloaded or changed, so it takes
# seconds.
#
# "Unchanged" is the run's own test (prepare.sh, DEPLOYED_INPUTS), made ahead
# of it: an extract is unchanged when the record a run would write for it
# (prepare.sh --latest-dates) is the deployed map's line of .inputs, and the
# code when its line is. An "unchanged" verdict means no run starts, so the
# check must never say it where the run would deploy: anything it cannot
# predict (an "unknown" record, either side) is new. The dates are only for
# reading - an extract can be rebuilt from data of the deployed day. A run
# that is forced, reuses a prepared map, or has no record of what the
# deployed map was built from deploys whatever the extracts, so those are new
# too.
check() {
  parse_flags "$@"
  C_NEW=""

  if [ -f "${RECORD_FILE}" ]; then
    sed -n 's/^# Deployed/  The map on the server was deployed/p' "${RECORD_FILE}"
  else
    echo "  No map has been deployed by this script yet."
  fi
  if [ -z "${FRESH}" ] && reusable_pruned; then
    # Imported whatever it holds, so its dates are compared, not records.
    echo "  A map prepared $(date -u -r "${PRUNED}" '+%Y-%m-%d %H:%M UTC') and not deployed yet is imported as it is (--fresh prepares anew):"
    C_NOW="$(cat "${SOURCES}")"
    C_NEW=1
  elif ! C_NOW="$(sh osmium-scripts/prepare.sh --latest-dates)"; then
    echo "${C_NOW}"
    if [ -z "${FORCE}" ]; then
      echo "ERROR: could not ask Geofabrik for the latest data"
      exit 1
    fi
    # A forced run deploys whatever the dates, so they need not stop it.
    echo "  (Could not ask Geofabrik for the latest data; forced, so the deploy can go ahead without it.)"
    C_NOW=""
    C_NEW=1
  fi
  echo ""

  # The extracts listed now, in list order, then any the deployed map has that
  # are no longer listed. C_NOW's lines are "extract: date record" (or
  # "extract: date" for a prepared map), the record's own spaces included; the
  # deployed dates are "extract: date", its records "extract: record".
  C_TABLE=""
  [ -z "${C_NOW}" ] || C_TABLE="$(echo "${C_NOW}" | awk -v dates="${RECORD_FILE}" -v records="${DEPLOYED_INPUTS_FILE}" '
    function entry(line) {
      i = index(line, ": ")
      if (i == 0) return 0
      NAME = substr(line, 1, i - 1)
      VALUE = substr(line, i + 2)
      return 1
    }
    BEGIN {
      while ((getline line < dates) > 0)
        if (line !~ /^#/ && entry(line)) { was[NAME] = VALUE; was_order[++n] = NAME }
      while ((getline line < records) > 0)
        if (entry(line)) was_record[NAME] = VALUE
    }
    entry($0) {
      now[++m] = NAME
      i = index(VALUE, " ")
      if (i == 0) { now_date[NAME] = VALUE; now_record[NAME] = "" }
      else { now_date[NAME] = substr(VALUE, 1, i - 1); now_record[NAME] = substr(VALUE, i + 1) }
    }
    END {
      w = 0
      for (i = 1; i <= m; i++) if (length(now[i]) > w) w = length(now[i])
      for (i = 1; i <= n; i++) if (length(was_order[i]) > w) w = length(was_order[i])
      for (i = 1; i <= m; i++) {
        name = now[i]
        to = now_date[name]
        from = (name in was) ? was[name] : "not deployed"
        if (now_record[name] == "")
          same = from == to && to != "unknown"
        else
          same = now_record[name] != "unknown" && (name in was_record) && now_record[name] == was_record[name]
        if (same) to = "unchanged"
        else if (from == to) to = to " (rebuilt: not exactly the deployed data)"
        printf "  %-" w "s  %s -> %s\n", name, from, to
      }
      for (i = 1; i <= n; i++)
        if (!(was_order[i] in now_date))
          printf "  %-" w "s  %s -> no longer listed\n", was_order[i], was[was_order[i]]
    }')"
  if [ -n "${C_TABLE}" ]; then
    echo "${C_TABLE}"
    C_TOTAL="$(echo "${C_TABLE}" | grep -c . || true)"
    C_CHANGED="$(echo "${C_TABLE}" | grep -vc ' -> unchanged$' || true)"
    [ "${C_CHANGED}" -eq 0 ] || C_NEW=1
    echo ""
    echo "  => ${C_CHANGED} of ${C_TOTAL} extracts changed"
  fi

  C_CODE="$(sh osmium-scripts/prepare.sh --code-inputs)"
  if [ ! -f "${DEPLOYED_INPUTS_FILE}" ]; then
    echo "  => no record of what the deployed map was built from (imported by hand?), so it is prepared anew"
    C_NEW=1
  elif [ "$(grep '^code:' "${DEPLOYED_INPUTS_FILE}")" != "${C_CODE}" ] || [ "${C_CODE}" = "code: unknown" ]; then
    echo "  => the code that prepares and imports the map (prepare.sh, src/scripts) changed since the deploy"
    C_NEW=1
  else
    echo "  => the code that prepares and imports the map (prepare.sh, src/scripts) is unchanged"
  fi
  if [ -n "${FORCE}" ]; then
    echo "  => forced (--force or --fresh): deploys whatever changed"
    C_NEW=1
  elif [ -f "${FORCE_FILE}" ]; then
    echo "  => forced: the last run was forced (--force or --fresh) and did not finish"
    C_NEW=1
  fi
  if [ -n "${C_NEW}" ]; then echo new; else echo unchanged; fi
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
  --check)
    check "$@"
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
    echo "Usage: remote-deploy.sh --check [flags] | --start [flags] | --follow | --state | --run [flags]"
    exit 1
    ;;
esac

# From here on: the deploy itself (--run). It sits in a session of its own
# with no terminal, so the only signal it gets is stop_deploy's TERM.

# deploy.sh reads the exit status from here once the process is gone; a missing
# file then means the run was killed outright (out of memory, most likely). The
# TERM trap turns a stop into an ordinary exit, so it is recorded too. A run
# that found nothing new sets RESULT instead, a word no exit status can be.
RESULT=""
trap 'STATUS=$?; echo "${RESULT:-${STATUS}}" > "${STATUS_FILE}"' EXIT
trap 'exit ${STOPPED_STATUS}' TERM

parse_flags "$@"
if [ -n "${FORCE}" ]; then
  : > "${FORCE_FILE}"
elif [ -f "${FORCE_FILE}" ]; then
  echo "Forced: the last run was forced (--force or --fresh) and did not finish"
  FORCE=1
fi

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

if [ -n "${FRESH}" ]; then
  echo "--fresh: discarding the pruned file and intermediates left by earlier runs"
  rm -rf "${DATA_DIR}/extracts"
  rm -f "${DATA_DIR}"/rail.tmp.* "${PRUNED}" "${SOURCES}"* "${INPUTS}"*
fi

if reusable_pruned; then
  echo "Reusing ${PRUNED}, prepared $(date -u -r "${PRUNED}" '+%Y-%m-%d %H:%M UTC') and not deployed yet (--fresh rebuilds it)"
else
  # What a run needs (DATA_DISK_RESERVE_GB, see prepare.sh). prepare.sh
  # downloads the next extract during the current one's filter only where the
  # disk has room for both, so this is enough either way; more only lets it
  # overlap more often. Failing here beats failing an hour in. Measured with
  # the raw cache's share of this disk already on it, which prepare.sh never
  # lets grow into the reserve - though the extracts it holds grow with every
  # update, so it first moves some off the data disk where they have (see
  # prepare.sh --make-room). In MB: whole GB would round 9.97 down to 9.
  sh osmium-scripts/prepare.sh --make-room
  NEEDED_MB=$(($(sh osmium-scripts/prepare.sh --data-disk-reserve-gb) * 1024))
  AVAILABLE_MB=$(($(df -Pk "${DATA_DIR}" | awk 'NR == 2 { print $4 }') / 1024))
  if [ "${AVAILABLE_MB}" -lt "${NEEDED_MB}" ]; then
    echo "ERROR: only ${AVAILABLE_MB} MB free on the data disk, ${NEEDED_MB} MB needed"
    exit 1
  fi

  # Not reusable, so cleared: prepare.sh writes no output when there is nothing
  # new, and a file left here would be taken for some.
  rm -f "${PRUNED}" "${SOURCES}" "${INPUTS}"
  echo ""
  if [ -n "${FORCE}" ]; then
    DEPLOYED_INPUTS="" npm run prepareMapData
  else
    DEPLOYED_INPUTS="${DEPLOYED_INPUTS_FILE}" npm run prepareMapData
  fi
  if [ ! -f "${PRUNED}" ]; then
    echo ""
    echo "=== Nothing to deploy: the server's map already has this data (--force deploys anyway) ==="
    RESULT="unchanged"
    exit 0
  fi
fi

echo ""
npm run importMapData -- "${PRUNED}" ${IMPORT_FLAGS}

# Recorded only now that the data is in the database. Kept on the server
# alone; deploy.sh reads its date when a run finds nothing new.
{
  echo "# The OSM data on the server: the date each Geofabrik extract was cut."
  echo "# Written by remote-deploy.sh after a successful map data deploy."
  echo "# Deployed $(date -u '+%Y-%m-%d %H:%M UTC')"
  echo ""
  cat "${SOURCES}"
} > "${RECORD_FILE}.part"
mv "${RECORD_FILE}.part" "${RECORD_FILE}"
# (A pruned file prepared before .inputs existed has none; with no record, the
# next run prepares anew.)
if [ -f "${INPUTS}" ]; then
  mv "${INPUTS}" "${DEPLOYED_INPUTS_FILE}"
fi
rm -f "${FORCE_FILE}"
# Kept only to resume a deploy that failed at the import; this one went in, so
# the next deploy prepares anew and the file is only taking up disk.
rm -f "${PRUNED}"

echo ""
echo "=== Map data deploy finished $(date -u '+%Y-%m-%d %H:%M UTC') ==="
