#!/usr/bin/env sh
# =============================================================================
# backup-mongo.sh — nightly Mongo replica-set + keyFile snapshot to S3
# -----------------------------------------------------------------------------
# Runs INSIDE the `backup` sidecar (alpine + awscli + mongodb-database-tools)
# from a cron entry at 03:30 UTC, OR can be invoked ad-hoc from the host:
#
#   docker compose -f infra/docker/docker-compose.prod.yml exec backup \
#       /usr/local/bin/backup-mongo.sh
#
# WHAT IT BACKS UP
#   1. A gzipped mongodump of the ENTIRE `ruletka` db taken via the replica-set
#      URI (the driver picks a SECONDARY for the read load when available, so
#      the dump does NOT hammer the primary).
#   2. A tar.gz of the replica-set internal /etc/mongo-keyfile (mounted read-
#      only). Without this file you CANNOT restore an existing on-disk volume
#      into a fresh cluster — the new mongods will reject the keyFile mismatch.
#
# WHERE IT UPLOADS
#   s3://$S3_BACKUP_BUCKET/mongo/<TIMESTAMP>/dump.gz
#   s3://$S3_BACKUP_BUCKET/mongo/<TIMESTAMP>/keyfile.tgz
#
#   $TIMESTAMP is produced by `date -u +%Y%m%dT%H%M%SZ` (SHELL date — note the
#   task note: we are NOT in JS, so no `new Date()` calls; the literal POSIX
#   `date` builtin is correct here, and the YYYYMMDDTHHMMSSZ format is
#   lexically sortable so retention-by-age math is just a string compare).
#
# RETENTION
#   After a successful upload, list every object under `mongo/` and delete any
#   whose TIMESTAMP prefix sorts BEFORE the cutoff computed as
#   `date -u -d "$BACKUP_RETENTION_DAYS days ago" +%Y%m%dT%H%M%SZ`. The image
#   is alpine, so we use `busybox date -d` (which supports relative arguments
#   like `-d "@<epoch>"` and `-d "30 days ago"` via the gnu-date package we
#   install in the compose service; see compose comment).
#
# WEBHOOK
#   On both SUCCESS and FAILURE, POST a small JSON body to $ALERT_WEBHOOK_URL
#   if it is set. The Telegram-alerting track (track O) wires this same URL
#   to the bot, so once it lands no extra work is needed here.
#
# EXIT CODES
#   0  — dump + keyfile + upload + retention all succeeded.
#   1+ — any step failed. Cron (or the sidecar entrypoint) records non-zero,
#        the webhook fires (if configured), and the operator sees the failure
#        in `docker compose logs backup`.
# =============================================================================
set -eu

# ── Required env (the compose service injects these from the host .env) ────────
: "${S3_BACKUP_BUCKET:?S3_BACKUP_BUCKET not set — see infra/deploy/backup/README.md}"
: "${S3_BACKUP_ACCESS_KEY_ID:?S3_BACKUP_ACCESS_KEY_ID not set}"
: "${S3_BACKUP_SECRET_ACCESS_KEY:?S3_BACKUP_SECRET_ACCESS_KEY not set}"
: "${S3_BACKUP_REGION:?S3_BACKUP_REGION not set}"
: "${S3_BACKUP_ENDPOINT_URL:?S3_BACKUP_ENDPOINT_URL not set (e.g. https://s3.timeweb.cloud)}"
: "${MONGO_APP_USERNAME:?MONGO_APP_USERNAME not set}"
: "${MONGO_APP_PASSWORD:?MONGO_APP_PASSWORD not set}"

BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
KEYFILE_PATH="${KEYFILE_PATH:-/etc/mongo-keyfile}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"

# ── awscli expects credentials in the standard env-var names ──────────────────
export AWS_ACCESS_KEY_ID="$S3_BACKUP_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_BACKUP_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="$S3_BACKUP_REGION"

AWS_S3="aws --endpoint-url $S3_BACKUP_ENDPOINT_URL s3"
AWS_S3API="aws --endpoint-url $S3_BACKUP_ENDPOINT_URL s3api"

# ── Sortable, lexicographically-comparable UTC timestamp (POSIX shell date) ──
# YYYYMMDDTHHMMSSZ — same shape ISO 8601 basic, no separators, so string-sort
# = chronological sort, which is what the retention loop relies on.
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
S3_PREFIX="s3://${S3_BACKUP_BUCKET}/mongo/${TIMESTAMP}"

DUMP_PATH="/tmp/dump.gz"
KEYFILE_TGZ="/tmp/keyfile.tgz"

log()  { printf '[backup-mongo] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FAILURE: $*"; notify "failure" "$*"; exit 1; }

# Optional Telegram/alert webhook. Best-effort — the alerting hook MUST NOT
# block the backup or cause spurious failures (so curl errors are swallowed).
notify() {
  status="$1"; message="$2"
  [ -z "$ALERT_WEBHOOK_URL" ] && return 0
  payload="$(printf '{"job":"backup-mongo","status":"%s","timestamp":"%s","bucket":"%s","key_prefix":"mongo/%s","message":"%s"}' \
                    "$status" "$TIMESTAMP" "$S3_BACKUP_BUCKET" "$TIMESTAMP" "$message")"
  curl -fsS --max-time 10 -H 'Content-Type: application/json' \
       -d "$payload" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || \
       log "warn: alert webhook POST failed (non-fatal)"
}

trap 'rm -f "$DUMP_PATH" "$KEYFILE_TGZ" 2>/dev/null || true' EXIT

# ── 1. mongodump (gzipped archive) ───────────────────────────────────────────
log "starting mongodump → $DUMP_PATH"
MONGO_URI="mongodb://${MONGO_APP_USERNAME}:${MONGO_APP_PASSWORD}@mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0&authSource=ruletka"

# --readPreference=secondaryPreferred lets the driver pull from a SECONDARY
# when one is healthy — the primary stays responsive to live traffic.
mongodump \
  --uri="$MONGO_URI" \
  --readPreference=secondaryPreferred \
  --gzip \
  --archive="$DUMP_PATH" \
  --quiet \
  || fail "mongodump failed"

DUMP_SIZE="$(wc -c < "$DUMP_PATH" 2>/dev/null || echo 0)"
log "mongodump done ($DUMP_SIZE bytes)"

# ── 2. tar the replica-set keyFile ───────────────────────────────────────────
# The keyFile is part of each mongod's on-disk identity. Without it you cannot
# restore an existing data volume into a fresh cluster (members reject the
# mismatch). The bind-mount is read-only inside this container; the tar runs
# as root and just packages the single file (mode 400 preserved).
log "tarring keyFile $KEYFILE_PATH → $KEYFILE_TGZ"
if [ ! -f "$KEYFILE_PATH" ]; then
  fail "keyFile not found at $KEYFILE_PATH (compose bind-mount missing?)"
fi
tar czf "$KEYFILE_TGZ" -C / "etc/mongo-keyfile" || fail "keyFile tar failed"

# ── 3. upload both to S3 ─────────────────────────────────────────────────────
log "uploading dump → $S3_PREFIX/dump.gz"
$AWS_S3 cp "$DUMP_PATH" "$S3_PREFIX/dump.gz" \
  --only-show-errors \
  || fail "S3 upload of dump.gz failed"

log "uploading keyFile → $S3_PREFIX/keyfile.tgz"
$AWS_S3 cp "$KEYFILE_TGZ" "$S3_PREFIX/keyfile.tgz" \
  --only-show-errors \
  || fail "S3 upload of keyfile.tgz failed"

# ── 4. retention sweep ───────────────────────────────────────────────────────
# Cutoff timestamp (UTC, same YYYYMMDDTHHMMSSZ shape) — anything whose object
# key starts with a TS prefix that sorts strictly LESS than this is too old
# and gets deleted. We rely on lexicographic = chronological because the
# timestamp format is fixed-width with leading zeroes.
CUTOFF="$(date -u -d "${BACKUP_RETENTION_DAYS} days ago" +%Y%m%dT%H%M%SZ 2>/dev/null || true)"
if [ -z "$CUTOFF" ]; then
  # BusyBox date in some alpine images lacks -d "X days ago"; fall back to
  # epoch math via `date -d "@<epoch>"` which BusyBox does support.
  NOW_EPOCH="$(date -u +%s)"
  CUTOFF_EPOCH=$(( NOW_EPOCH - BACKUP_RETENTION_DAYS * 86400 ))
  CUTOFF="$(date -u -d "@${CUTOFF_EPOCH}" +%Y%m%dT%H%M%SZ)"
fi
log "retention cutoff = $CUTOFF (delete objects older than ${BACKUP_RETENTION_DAYS}d)"

# List every object under mongo/, extract the timestamp prefix, and delete the
# whole prefix if it is older than the cutoff. We list keys (NOT versions) so
# this also works on non-versioned buckets like Timeweb-S3.
PREFIXES="$($AWS_S3API list-objects-v2 \
              --bucket "$S3_BACKUP_BUCKET" \
              --prefix "mongo/" \
              --delimiter "/" \
              --query 'CommonPrefixes[].Prefix' \
              --output text 2>/dev/null || true)"

# `aws ... --output text` returns tab-separated tokens on one line — split.
DELETED=0
for p in $PREFIXES; do
  # Strip leading "mongo/" and trailing "/" → bare timestamp.
  ts="${p#mongo/}"
  ts="${ts%/}"
  # Skip anything that does not look like our timestamp format (defensive).
  case "$ts" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) : ;;
    *) continue ;;
  esac
  if [ "$ts" \< "$CUTOFF" ]; then
    log "retention: deleting s3://${S3_BACKUP_BUCKET}/${p}"
    $AWS_S3 rm "s3://${S3_BACKUP_BUCKET}/${p}" --recursive --only-show-errors \
      || log "warn: failed to delete ${p} (continuing)"
    DELETED=$(( DELETED + 1 ))
  fi
done
log "retention sweep done (deleted $DELETED snapshot(s))"

# ── 5. success webhook + exit ────────────────────────────────────────────────
SUCCESS_MSG="dump=${DUMP_SIZE}B uploaded to ${S3_PREFIX}; retention swept ${DELETED} old snapshot(s)"
log "SUCCESS: $SUCCESS_MSG"
notify "success" "$SUCCESS_MSG"
exit 0
