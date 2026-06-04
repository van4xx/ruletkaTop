#!/usr/bin/env bash
# =============================================================================
# auto-deploy.sh — SERVER-SIDE pull-deploy for ruletka.top
# -----------------------------------------------------------------------------
# A systemd timer runs this every minute. When origin/main has new commits it
# syncs the checkout and re-runs the idempotent bootstrap.sh — so a `git push`
# is live within ~60s with nothing to click.
#
# WHY pull instead of push: GitHub's Azure-hosted runners cannot hold a reliable
# connection to this server — the Azure↔Timeweb path drops at a fixed ~2m23s and
# loses output (the same lossy path that broke ACME http-01). So the SERVER pulls
# from GitHub (server→GitHub is reliable) instead of being pushed to. Nothing
# crosses the bad link.
#
# Install: see infra/deploy/systemd/ + DEPLOY notes. Logs to /opt/ruletka/auto-deploy.log
# =============================================================================
set -uo pipefail

DIR="${RULETKA_DIR:-/opt/ruletka}"
LOG="$DIR/auto-deploy.log"
cd "$DIR" 2>/dev/null || { echo "auto-deploy: $DIR not found" >&2; exit 0; }

# Serialize: a build can outlast the 1-minute tick, so never overlap two deploys.
exec 9>"$DIR/.auto-deploy.lock"
flock -n 9 || exit 0   # another deploy already running → skip this tick

git fetch --quiet --depth 1 origin main 2>>"$LOG" || exit 0
LOCAL="$(git rev-parse HEAD 2>/dev/null || true)"
REMOTE="$(git rev-parse origin/main 2>/dev/null || true)"
# Up to date (or couldn't read refs) → nothing to do.
[ -z "$REMOTE" ] || [ "$LOCAL" = "$REMOTE" ] && exit 0

{
  echo "==== $(date -u +%FT%TZ) deploy ${LOCAL:0:7} -> ${REMOTE:0:7} ===="
  git reset --hard origin/main
  bash infra/deploy/bootstrap.sh
  echo "==== $(date -u +%FT%TZ) finished (exit $?) ===="
  echo
} >>"$LOG" 2>&1
