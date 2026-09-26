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
# The server's log streams here as it is written. Ctrl+C stops the deploy on
# the server too - and so does closing the terminal or losing the connection,
# since the server stops the deploy when the session following it ends (see
# remote-deploy.sh for why that is the reliable way to get Ctrl+C there). A
# rerun resumes from what the stopped one finished. `--follow` shows a deploy
# in progress, or the last one's log. On success the
# recalculation summary is printed again at the end and
# osmium-scripts/deployed-extracts.txt is updated with the date of every
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
    # Via a temporary file, so a failed read leaves the committed record alone.
    remote 'cat data/deployed-extracts.txt' > "${RECORD_FILE}.part"
    mv "${RECORD_FILE}.part" "${RECORD_FILE}"
    echo "=== Deploy complete ==="
    echo "Updated ${RECORD_FILE} - commit it:"
    grep -v '^#' "${RECORD_FILE}" | grep . | sed 's/^/  /'
    ;;
  143)
    echo "The deploy was stopped."
    echo "Rerun to continue; regions already prepared are reused."
    exit 1
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
