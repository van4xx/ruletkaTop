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
# AUTO-ROLLBACK. Before every reset-to-HEAD we snapshot the CURRENT commit sha
# to a rollback marker file (.auto-deploy.last-good). After bootstrap finishes
# we smoke-test /api/health within 60s; if it does not respond 200, we
# git-reset back to the snapshot sha and re-run bootstrap. Better a 1-minute
# rollback than a multi-minute outage on a bad commit. (Note: rollback only
# reverts CODE; .env edits and Mongo data are forward-compatible by design.)
#
# Install: see infra/deploy/systemd/ + DEPLOY notes. Logs to /opt/ruletka/auto-deploy.log
# =============================================================================
set -uo pipefail

DIR="${RULETKA_DIR:-/opt/ruletka}"
LOG="$DIR/auto-deploy.log"
ROLLBACK_MARKER="$DIR/.auto-deploy.last-good"
HEALTH_URL="${HEALTH_URL:-https://api.ruletka.top/api/health}"
HEALTH_TIMEOUT_SECS="${HEALTH_TIMEOUT_SECS:-60}"

cd "$DIR" 2>/dev/null || { echo "auto-deploy: $DIR not found" >&2; exit 0; }

# Serialize: a build can outlast the 1-minute tick, so never overlap two deploys.
exec 9>"$DIR/.auto-deploy.lock"
flock -n 9 || exit 0   # another deploy already running → skip this tick

git fetch --quiet --depth 1 origin main 2>>"$LOG" || exit 0
LOCAL="$(git rev-parse HEAD 2>/dev/null || true)"
REMOTE="$(git rev-parse origin/main 2>/dev/null || true)"
# Up to date (or couldn't read refs) → nothing to do.
[ -z "$REMOTE" ] || [ "$LOCAL" = "$REMOTE" ] && exit 0

# Smoke-test helper: poll the health URL for up to HEALTH_TIMEOUT_SECS.
# Echoes "ok" on success, anything else on failure. Stdout-only — caller logs.
smoke_test() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECS ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      echo ok; return 0
    fi
    sleep 3
  done
  echo fail; return 1
}

{
  echo "==== $(date -u +%FT%TZ) deploy ${LOCAL:0:7} -> ${REMOTE:0:7} ===="

  # 1) Snapshot the CURRENT (pre-reset) sha BEFORE we move. If anything goes
  #    sideways we git-reset back here. Skip if LOCAL is empty (initial clone).
  if [ -n "$LOCAL" ]; then
    printf '%s\n' "$LOCAL" > "$ROLLBACK_MARKER"
    echo "rollback marker written: $LOCAL"
  fi

  # 2) Apply the new code + run bootstrap.
  git reset --hard origin/main
  bootstrap_rc=0
  bash infra/deploy/bootstrap.sh || bootstrap_rc=$?
  echo "bootstrap exit=$bootstrap_rc"

  # 3) Smoke-test /api/health. If bootstrap exited non-zero OR the API is not
  #    serving healthy responses within the window, AUTO-ROLLBACK to the
  #    pre-reset sha and re-run bootstrap. Loud log either way.
  smoke_result="$(smoke_test || true)"
  if [ "$smoke_result" = "ok" ] && [ "$bootstrap_rc" = "0" ]; then
    echo "smoke-test OK (api/health 200 within ${HEALTH_TIMEOUT_SECS}s)"
  else
    if [ -s "$ROLLBACK_MARKER" ] && [ -n "$LOCAL" ]; then
      ROLLBACK_TO="$(cat "$ROLLBACK_MARKER")"
      echo "!!!! SMOKE-TEST FAILED (bootstrap=$bootstrap_rc, smoke=$smoke_result) — AUTO-ROLLBACK to ${ROLLBACK_TO:0:7}"
      # Reset CODE only. Volumes / .env unaffected; .env is forward-compatible
      # by design (upsert_env only ADDS keys), so rolling back code is safe.
      git reset --hard "$ROLLBACK_TO" 2>>"$LOG" || echo "rollback git-reset FAILED"
      bash infra/deploy/bootstrap.sh || echo "rollback bootstrap exit non-zero — manual intervention required"
      rollback_smoke="$(smoke_test || true)"
      if [ "$rollback_smoke" = "ok" ]; then
        echo "rollback OK — site healthy on ${ROLLBACK_TO:0:7}. INVESTIGATE the failed commit before re-pushing."
      else
        echo "!!!! ROLLBACK ALSO FAILED — site DOWN, manual intervention required. Check '$LOG'."
      fi
    else
      echo "!!!! SMOKE-TEST FAILED and no rollback marker available — manual intervention required."
    fi
  fi

  echo "==== $(date -u +%FT%TZ) finished ===="
  echo
} >>"$LOG" 2>&1
