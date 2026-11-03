#!/bin/bash

# Deploy map data: prepare it on the server, import it there, and report back.
# Run from your own machine; the work happens on the server (remote-deploy.sh),
# which downloads the latest Geofabrik extract of every country listed in
# osmium-scripts/extracts.txt, so there is no date to pass.
#
# Flags (any order):
#   --valid-only       recalculate only routes not already invalid
#   --concurrency=N    how many routes the import recalculates at once
#                      (see RECALC_PERFORMANCE.md)
#   --force            deploy even when neither the extracts nor the code
#                      that prepares and imports them (prepare.sh,
#                      src/scripts) has changed since the last deploy;
#                      otherwise the run stops there. A stopped or failed
#                      forced run stays forced when rerun
#   --fresh            discard what earlier runs left on the server - a pruned
#                      map not deployed yet, and every filtered extract kept
#                      (~35GB to download again, less what the raw cache
#                      holds, which it keeps) - instead of reusing it; implies
#                      --force
#   --yes              start without asking (see below)
#   --follow           start nothing; reattach to the run in progress, or
#                      report on the last one
# Example: npm run deployMapData -- --valid-only
#
# Before anything starts, the server lists each extract's date in the deployed
# map beside the latest Geofabrik has ("europe/austria  2026-11-02 ->
# 2026-11-03", or "-> unchanged") and says whether the code that prepares the
# map changed. When nothing did, the deploy stops there; otherwise it asks
# whether to go ahead. --yes skips the question, and a deploy with no terminal
# to ask on (stdin closed) needs it.
#
# The server's log streams here as it is written. Ctrl+C stops the deploy on
# the server too - and so does closing the terminal or losing the connection,
# since the server stops the deploy when the session following it ends (see
# remote-deploy.sh for why that is the reliable way to get Ctrl+C there). A
# rerun resumes from what the stopped one finished. `--follow` shows a deploy
# in progress, or the last one's log. On success the recalculation summary is
# printed again at the end. Which data the server's map holds is recorded
# there alone (data/deployed-extracts.txt); a run's first step lists each
# extract's date.
#
# The server runs its own checkout of the repository, which this pulls first.
# So what it runs is what you have pushed: the deploy refuses to start while
# local commits are unpushed or the pipeline's own files have local changes.

set -e

REMOTE_HOST="railmap@railmap.zlatkovsky.cz"
REMOTE_DIR="/home/railmap/osm-trains"

# Flags are matched explicitly, so a mistyped one (or a date, which older
# versions of this script took) stops the deploy instead of being dropped.
REMOTE_ARGS=""
FOLLOW_ONLY=""
ASSUME_YES=""
for arg in "$@"; do
  case "$arg" in
    --valid-only | --force | --fresh | --concurrency=*) REMOTE_ARGS="${REMOTE_ARGS} $arg" ;;
    --yes) ASSUME_YES=1 ;;
    --follow) FOLLOW_ONLY=1 ;;
    *)
      echo "ERROR: Unknown argument '$arg'"
      echo "Usage: npm run deployMapData -- [--valid-only] [--concurrency=N] [--force] [--fresh] [--yes] [--follow]"
      echo "(Extracts are always the latest from Geofabrik; there is no date to pass.)"
      exit 1
      ;;
  esac
done

# The server's log is UTF-8 (station names, the import's arrows), and a Windows
# console started from PowerShell or cmd shows it in its OEM code page, 437 on
# an English Windows, where "✓" arrives as "Γ£ô". So the console is switched
# to UTF-8 for the run, and back when it ends. chcp.com exists only on
# Windows; it is harmless under mintty, which is UTF-8 already. Best effort:
# a console that refuses the switch only keeps its mojibake.
if command -v chcp.com > /dev/null 2>&1; then
  CONSOLE_CP="$(chcp.com 2> /dev/null | tr -dc '0-9')" || CONSOLE_CP=""
  if [ -n "${CONSOLE_CP}" ] && [ "${CONSOLE_CP}" != 65001 ] &&
    chcp.com 65001 > /dev/null 2>&1; then
    trap 'chcp.com "${CONSOLE_CP}" > /dev/null 2>&1' EXIT
  fi
fi

say_nothing_new() {
  echo "=== Nothing new to deploy: the server's map already has the latest data ==="
  echo "(--force deploys anyway)"
}

remote() {
  plink -batch "${REMOTE_HOST}" "cd ${REMOTE_DIR} && $1"
}

# With a pty (-t), so the remote output arrives as it is written rather than in
# pipe-sized chunks, and so the session's end reaches the server as a hangup.
remote_tty() {
  plink -batch -t "${REMOTE_HOST}" "cd ${REMOTE_DIR} && $1"
}

if [ -z "${FOLLOW_ONLY}" ]; then
  echo "=== Checking that the server will run what you have ==="
  # The pipeline and its dependencies block the deploy; src/lib only warns,
  # since the import reaches a few modules there but most of it is the web app,
  # edited all the time.
  PIPELINE_PATHS="osmium-scripts src/scripts package.json package-lock.json"
  if [ -n "$(git status --porcelain -- ${PIPELINE_PATHS})" ]; then
    echo "ERROR: uncommitted changes to the pipeline - the server would not see them:"
    git status --short -- ${PIPELINE_PATHS}
    exit 1
  fi
  if [ -n "$(git status --porcelain -- src/lib)" ]; then
    echo "WARNING: uncommitted changes in src/lib - the server imports with the pushed versions:"
    git status --short -- src/lib
  fi
  git fetch --quiet origin
  LOCAL_HEAD="$(git rev-parse HEAD)"
  if [ "${LOCAL_HEAD}" != "$(git rev-parse origin/main)" ]; then
    echo "ERROR: HEAD is not origin/main - push (or check out main) first, the server pulls main"
    exit 1
  fi

  # One run at a time: two would fight over the same files and tables. Checked
  # here as well as by --start because the pull below must not change the
  # scripts under a running deploy. (A checkout from before --state existed
  # answers with an error, which is not "running" either - correctly.)
  if [ "$(remote "bash osmium-scripts/remote-deploy.sh --state" 2> /dev/null)" = "running" ]; then
    echo "ERROR: a deploy is already running on the server; reattach with: npm run deployMapData -- --follow"
    exit 1
  fi

  echo ""
  echo "=== Updating the server's checkout ==="
  # node_modules is reinstalled only when it was not installed from this
  # lockfile, since npm ci starts from an empty node_modules and takes a while
  # on the server. The hash is written inside node_modules and only once npm ci
  # has succeeded, so a failed install (which has already emptied the folder)
  # is retried on the next deploy rather than taken as done - comparing the
  # lockfile across the pull could not tell, the pull having already happened.
  remote "git pull --ff-only --quiet origin main &&
    { [ \"\$(git rev-parse HEAD)\" = ${LOCAL_HEAD} ] || { echo 'ERROR: the server did not end up on your HEAD'; exit 1; }; } &&
    git log --oneline -1 &&
    if [ \"\$(sha256sum package-lock.json)\" != \"\$(cat node_modules/.deploy-lockfile.sha256 2> /dev/null)\" ]; then
      echo 'node_modules was not installed from this package-lock.json - running npm ci' &&
        . ~/.nvm/nvm.sh > /dev/null && npm ci --no-audit --no-fund &&
        sha256sum package-lock.json > node_modules/.deploy-lockfile.sha256
    fi"

  # After the pull, so the server checks with the code it will run - which is
  # also the code the check compares with the deployed map's.
  echo ""
  echo "=== Checking for new data (deployed -> latest) ==="
  CHECK="$(remote "bash osmium-scripts/remote-deploy.sh --check${REMOTE_ARGS}")" || {
    echo "${CHECK}"
    echo "ERROR: the check failed - nothing was started"
    exit 1
  }
  # All but the last line is for reading; the last is the verdict.
  echo "${CHECK}" | sed '$d'
  case "$(echo "${CHECK}" | tail -n 1 | tr -d '\r')" in
    new) ;;
    unchanged)
      echo ""
      say_nothing_new
      exit 0
      ;;
    *)
      echo "ERROR: the check gave no verdict - nothing was started"
      exit 1
      ;;
  esac
  if [ -z "${ASSUME_YES}" ]; then
    echo ""
    printf "Deploy? [y/N] "
    # read fails on a closed stdin (no terminal), which is not a yes.
    if ! read -r ANSWER; then
      echo ""
      echo "No answer (no terminal?) - nothing was started. --yes deploys without asking."
      exit 1
    fi
    case "${ANSWER}" in
      [yY] | [yY][eE][sS]) ;;
      *)
        echo "Nothing was started."
        exit 0
        ;;
    esac
  fi
fi

# A Ctrl+C kills plink; this script outlives it to report how the deploy ended.
# A handler rather than `trap '' INT`: an ignored SIGINT is inherited, and on
# Windows that would make plink ignore the Ctrl+C as well.
trap 'echo ""' INT

echo ""
if [ -z "${FOLLOW_ONLY}" ]; then
  echo "=== Deploying on the server (Ctrl+C stops it) ==="
  remote_tty "bash osmium-scripts/remote-deploy.sh --start${REMOTE_ARGS}" || true
else
  echo "=== Server log (data/deploy.log; Ctrl+C stops the deploy) ==="
  remote_tty "bash osmium-scripts/remote-deploy.sh --follow" || true
fi

# Once the session has ended, a deploy still running is one being stopped (the
# server gives it up to ~10s to wind down), so wait for the verdict rather than
# report a half-finished stop. Under set -e a failed substitution would end the
# script right here, with no word of what happened, hence the ||.
for _ in $(seq 15); do
  STATE="$(remote "bash osmium-scripts/remote-deploy.sh --state")" || STATE="unreachable"
  [ "${STATE}" = "running" ] || break
  sleep 1
done

echo ""
case "${STATE}" in
  none)
    echo "No deploy has run on the server yet."
    exit 1
    ;;
  running)
    echo "The deploy is still running on the server, though it should have stopped with the session."
    echo "Check with: npm run deployMapData -- --follow (Ctrl+C there stops it)"
    exit 1
    ;;
  unreachable)
    echo "Cannot reach the server. A deploy stops when its session ends, so it has most likely stopped;"
    echo "check with: npm run deployMapData -- --follow"
    exit 1
    ;;
  0)
    echo "=== Route recheck ==="
    remote "sed -n '/=== Route Recalculation Summary ===/,/=== Step 3/p' data/deploy.log | sed '\$d'" || true
    echo ""
    echo "=== Deploy complete ==="
    ;;
  unchanged)
    say_nothing_new
    remote "sed -n 's/^# Deployed/Last deployed/p' data/deployed-extracts.txt" || true
    ;;
  143)
    echo "The deploy was stopped."
    echo "Rerun to continue; finished extracts, and a map already prepared, are reused."
    exit 1
    ;;
  killed)
    echo "ERROR: the deploy died without finishing (killed - out of memory?)."
    echo "Rerun to retry; finished extracts, and a map already prepared, are reused."
    exit 1
    ;;
  *)
    echo "ERROR: the deploy failed (exit status ${STATE}) - see the log above."
    echo "Rerun to retry; finished extracts, and a map already prepared, are reused (--fresh to start over)."
    exit 1
    ;;
esac
