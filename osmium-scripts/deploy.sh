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
#   --fresh            discard what an earlier failed run left on the server
#                      (pruned regions, finished extracts) instead of reusing it
#   --follow           start nothing; reattach to the run in progress, or
#                      report on the last one
# Example: npm run deployMapData -- --valid-only
#
# The run is detached from this SSH session, so closing the terminal or losing
# the connection does not stop it - `npm run deployMapData -- --follow` picks the
# log back up. On success the recalculation summary is printed again at the end
# and osmium-scripts/deployed-extracts.txt is updated with the date of every
# extract that went in; commit it.
#
# The server runs its own checkout of the repository, which this pulls first.
# So what it runs is what you have pushed: the deploy refuses to start while
# local commits are unpushed or the pipeline's own files have local changes.

set -e

REMOTE_HOST="railmap@railmap.zlatkovsky.cz"
REMOTE_DIR="/home/railmap/osm-trains"
RECORD_FILE="osmium-scripts/deployed-extracts.txt"

# Flags are matched explicitly, so a mistyped one (or a date, which older
# versions of this script took) stops the deploy instead of being dropped.
REMOTE_ARGS=""
FOLLOW_ONLY=""
for arg in "$@"; do
  case "$arg" in
    --valid-only | --fresh | --concurrency=*) REMOTE_ARGS="${REMOTE_ARGS} $arg" ;;
    --follow) FOLLOW_ONLY=1 ;;
    *)
      echo "ERROR: Unknown argument '$arg'"
      echo "Usage: npm run deployMapData -- [--valid-only] [--concurrency=N] [--fresh] [--follow]"
      echo "(Extracts are always the latest from Geofabrik; there is no date to pass.)"
      exit 1
      ;;
  esac
done

remote() {
  plink -batch "${REMOTE_HOST}" "cd ${REMOTE_DIR} && $1"
}

# True on the server while a deploy runs. The pid file outlives its process, and
# a pid is eventually handed to something else, so the process must also still
# be remote-deploy.sh - a bare kill -0 would one day block every deploy on an
# unrelated process and leave --follow tailing forever.
RUNNING_TEST='[ -f data/deploy.pid ] && grep -qs remote-deploy.sh "/proc/$(cat data/deploy.pid)/cmdline"'

if [ -z "${FOLLOW_ONLY}" ]; then
  echo "=== Checking that the server will run what you have ==="
  # The pipeline and its dependencies block the deploy; src/lib only warns,
  # since the import reaches a few modules there but most of it is the web app,
  # edited all the time.
  PIPELINE_PATHS="osmium-scripts src/scripts package.json package-lock.json"
  if [ -n "$(git status --porcelain -- ${PIPELINE_PATHS} ":!${RECORD_FILE}")" ]; then
    echo "ERROR: uncommitted changes to the pipeline - the server would not see them:"
    git status --short -- ${PIPELINE_PATHS} ":!${RECORD_FILE}"
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

  # One run at a time: two would fight over the same files and tables.
  if remote "${RUNNING_TEST}"; then
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

  echo ""
  echo "=== Starting the deploy on the server ==="
  remote "mkdir -p data && nohup bash osmium-scripts/remote-deploy.sh${REMOTE_ARGS} > data/deploy.log 2>&1 < /dev/null & echo \$! > data/deploy.pid"
  echo "Running detached - closing this terminal does not stop it."
  echo "Reattach with: npm run deployMapData -- --follow"
fi

echo ""
echo "=== Server log (data/deploy.log) ==="
# tail exits by itself once the deploy process does; a finished run's log is
# printed as it stands. If the connection drops first, plink fails and the state
# check below says the run is still going.
remote "if ${RUNNING_TEST}; then tail -n +1 -f --pid=\"\$(cat data/deploy.pid)\" data/deploy.log; else cat data/deploy.log; fi" 2> /dev/null || true

# Under set -e a failed substitution would end the script right here, with no
# word of what happened - exactly when the hint below matters most.
STATE="$(remote "if [ ! -f data/deploy.pid ]; then echo none; elif ${RUNNING_TEST}; then echo running; elif [ -f data/deploy.status ]; then cat data/deploy.status; else echo killed; fi")" ||
  STATE="unreachable"

echo ""
case "${STATE}" in
  none)
    echo "No deploy has run on the server yet."
    exit 1
    ;;
  running)
    echo "Lost the connection, but the deploy is still running on the server."
    echo "Reattach with: npm run deployMapData -- --follow"
    exit 1
    ;;
  unreachable)
    echo "Lost the connection and cannot reach the server; the deploy is probably still running."
    echo "Reattach with: npm run deployMapData -- --follow"
    exit 1
    ;;
  0)
    echo "=== Route recheck ==="
    remote "sed -n '/=== Route Recalculation Summary ===/,/=== Step 3/p' data/deploy.log | sed '\$d'" || true
    echo ""
    # Via a temporary file, so a failed read leaves the committed record alone.
    remote 'cat data/deployed-extracts.txt' > "${RECORD_FILE}.part"
    mv "${RECORD_FILE}.part" "${RECORD_FILE}"
    echo "=== Deploy complete ==="
    echo "Updated ${RECORD_FILE} - commit it:"
    grep -v '^#' "${RECORD_FILE}" | grep . | sed 's/^/  /'
    ;;
  killed)
    echo "ERROR: the deploy died without finishing (killed - out of memory?)."
    echo "Rerun to retry; regions already prepared are reused."
    exit 1
    ;;
  *)
    echo "ERROR: the deploy failed (exit status ${STATE}) - see the log above."
    echo "Rerun to retry; regions already prepared are reused (--fresh to start over)."
    exit 1
    ;;
esac
