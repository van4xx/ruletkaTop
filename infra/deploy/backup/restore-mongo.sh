#!/usr/bin/env sh
# =============================================================================
# restore-mongo.sh — operator-facing point-in-time restore from S3
# -----------------------------------------------------------------------------
# Pulls a chosen snapshot out of s3://$S3_BACKUP_BUCKET/mongo/ and runs
# `mongorestore --drop --gzip --archive=...` against the supplied MONGODB_URI.
#
# WHO RUNS THIS
#   AN OPERATOR, by hand, on a NON-PROD cluster (staging / disaster-recovery
#   sandbox). Restoring to live prod silently destroys current data, so this
#   script REFUSES to run when MONGODB_URI looks like the production replica
#   set (mongo1/mongo2/mongo3 hostnames). Override with FORCE_RESTORE_PROD=1
#   IF AND ONLY IF you are intentionally rebuilding prod from a snapshot and
#   have confirmed the live volumes are already gone.
#
# USAGE
#   # interactive — lists snapshots desc, prompts which to restore
#   docker compose -f infra/docker/docker-compose.prod.yml exec backup \
#       /usr/local/bin/restore-mongo.sh
#
#   # non-interactive — pass the snapshot TIMESTAMP via env
#   BACKUP_NAME=20260611T033000Z \
#   docker compose ... exec backup /usr/local/bin/restore-mongo.sh
#
# REQUIRED env (same as backup-mongo.sh, plus MONGODB_URI):
#   S3_BACKUP_BUCKET, S3_BACKUP_ACCESS_KEY_ID, S3_BACKUP_SECRET_ACCESS_KEY,
#   S3_BACKUP_REGION, S3_BACKUP_ENDPOINT_URL, MONGODB_URI.
# =============================================================================
set -eu

: "${S3_BACKUP_BUCKET:?S3_BACKUP_BUCKET not set}"
: "${S3_BACKUP_ACCESS_KEY_ID:?S3_BACKUP_ACCESS_KEY_ID not set}"
: "${S3_BACKUP_SECRET_ACCESS_KEY:?S3_BACKUP_SECRET_ACCESS_KEY not set}"
: "${S3_BACKUP_REGION:?S3_BACKUP_REGION not set}"
: "${S3_BACKUP_ENDPOINT_URL:?S3_BACKUP_ENDPOINT_URL not set}"
: "${MONGODB_URI:?MONGODB_URI not set — point this at the NON-PROD target}"

export AWS_ACCESS_KEY_ID="$S3_BACKUP_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_BACKUP_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$S3_BACKUP_REGION"

AWS_S3="aws --endpoint-url $S3_BACKUP_ENDPOINT_URL s3"
AWS_S3API="aws --endpoint-url $S3_BACKUP_ENDPOINT_URL s3api"

log() { printf '[restore-mongo] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "FATAL: $*"; exit 1; }

# ── 1. PROD GUARD ─────────────────────────────────────────────────────────────
# Hard-stop when the target URI references the prod replica-set hosts. The
# guard fires on ANY of the three mongoN hostnames being present, because a
# legitimate prod URI lists all three. Override only with explicit env opt-in.
LOOKS_LIKE_PROD=0
case "$MONGODB_URI" in
  *mongo1:27017*|*mongo2:27017*|*mongo3:27017*) LOOKS_LIKE_PROD=1 ;;
esac
if [ "$LOOKS_LIKE_PROD" = "1" ] && [ "${FORCE_RESTORE_PROD:-0}" != "1" ]; then
  die "MONGODB_URI looks like PRODUCTION (mongo1/2/3:27017). Refusing to --drop the live cluster. If you really mean to rebuild prod from a snapshot, re-run with FORCE_RESTORE_PROD=1."
fi

# ── 2. discover available snapshots, sort desc ───────────────────────────────
log "listing snapshots under s3://${S3_BACKUP_BUCKET}/mongo/ …"
ALL_PREFIXES="$($AWS_S3API list-objects-v2 \
                  --bucket "$S3_BACKUP_BUCKET" \
                  --prefix "mongo/" \
                  --delimiter "/" \
                  --query 'CommonPrefixes[].Prefix' \
                  --output text 2>/dev/null || true)"

[ -n "$ALL_PREFIXES" ] || die "no snapshots found in s3://${S3_BACKUP_BUCKET}/mongo/"

# Strip the mongo/...//, keep just the timestamps, newline-separated, sorted desc.
TIMESTAMPS="$(printf '%s\n' $ALL_PREFIXES | sed 's|^mongo/||; s|/$||' | sort -r)"

# ── 3. choose which snapshot ─────────────────────────────────────────────────
BACKUP_NAME="${BACKUP_NAME:-}"
if [ -z "$BACKUP_NAME" ]; then
  if [ -t 0 ]; then
    log "available snapshots (newest first):"
    i=1
    # POSIX shell — no associative arrays. Emit a numbered list + remember.
    printf '%s\n' "$TIMESTAMPS" | head -20 | while IFS= read -r ts; do
      printf '  %2d) %s\n' "$i" "$ts"
      i=$(( i + 1 ))
    done
    printf 'Enter snapshot name (the YYYYMMDDTHHMMSSZ token) or "latest": '
    read -r choice
    if [ "$choice" = "latest" ] || [ -z "$choice" ]; then
      BACKUP_NAME="$(printf '%s\n' "$TIMESTAMPS" | head -1)"
    else
      BACKUP_NAME="$choice"
    fi
  else
    # Non-interactive default = latest.
    BACKUP_NAME="$(printf '%s\n' "$TIMESTAMPS" | head -1)"
    log "non-interactive — defaulting to latest snapshot: $BACKUP_NAME"
  fi
fi

# Validate.
echo "$TIMESTAMPS" | grep -Fxq "$BACKUP_NAME" \
  || die "snapshot '$BACKUP_NAME' not found in bucket (use one of the listed timestamps)"

S3_PREFIX="s3://${S3_BACKUP_BUCKET}/mongo/${BACKUP_NAME}"
DUMP_PATH="/tmp/restore-dump.gz"
KEYFILE_TGZ="/tmp/restore-keyfile.tgz"

trap 'rm -f "$DUMP_PATH" "$KEYFILE_TGZ" 2>/dev/null || true' EXIT

# ── 4. download artefacts ────────────────────────────────────────────────────
log "downloading $S3_PREFIX/dump.gz → $DUMP_PATH"
$AWS_S3 cp "$S3_PREFIX/dump.gz" "$DUMP_PATH" --only-show-errors \
  || die "S3 download of dump.gz failed"

log "downloading $S3_PREFIX/keyfile.tgz → $KEYFILE_TGZ (informational — extract by hand if rebuilding RS)"
$AWS_S3 cp "$S3_PREFIX/keyfile.tgz" "$KEYFILE_TGZ" --only-show-errors \
  || log "warn: keyfile download failed (continuing — keyFile only matters when rebuilding RS members)"

# ── 5. confirm with the operator ─────────────────────────────────────────────
if [ -t 0 ] && [ "${SKIP_CONFIRM:-0}" != "1" ]; then
  printf '\nAbout to RESTORE snapshot %s into:\n  %s\nwith --drop (existing collections in that db WILL BE WIPED).\nType YES to proceed: ' \
         "$BACKUP_NAME" "$MONGODB_URI"
  read -r ack
  [ "$ack" = "YES" ] || die "aborted by operator"
fi

# ── 6. mongorestore ─────────────────────────────────────────────────────────
log "running mongorestore --drop --gzip --archive=$DUMP_PATH …"
mongorestore \
  --uri="$MONGODB_URI" \
  --gzip \
  --archive="$DUMP_PATH" \
  --drop \
  --noIndexRestore=false \
  --stopOnError \
  || die "mongorestore failed"

log "SUCCESS: $BACKUP_NAME restored into target"
exit 0
