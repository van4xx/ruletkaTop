#!/bin/sh
# =============================================================================
# nginx-watchdog — count 5xx events in a sliding window and POST a Telegram
# alert when the threshold is crossed. POSIX `sh` only (Alpine /bin/sh = ash);
# no bashisms. Designed to run as a Docker sidecar with the nginx logs volume
# mounted read-only.
#
# WHAT IT WATCHES
#   `tail -F /var/log/nginx/access.log` — `-F` follows logrotate (re-opens on
#   rename/truncate) so a rotated log never silently stops the watchdog.
#
# THE SLIDING-WINDOW TRICK (no external state, no bash array)
#   We append each 5xx event's UNIX timestamp + path to a tmp file
#   ($STATE_FILE). On every new event we recompute the window by streaming
#   that file through awk and keeping only the rows whose timestamp is within
#   NGINX_WINDOW_SECONDS of "now" — older rows are dropped. The kept count is
#   the live event count in the window; we rewrite STATE_FILE with the kept
#   rows so the file stays bounded (proportional to the burst rate, not the
#   uptime). When count >= NGINX_5XX_THRESHOLD AND at least 60s have passed
#   since the last alert (independent throttle), we POST to Telegram.
#
#   This is the same algorithm the in-process AlertingService uses, but
#   expressed entirely in shell + awk so the sidecar has zero runtime deps
#   beyond alpine's busybox + curl.
#
# REQUIRED ENV
#   TELEGRAM_BOT_TOKEN        — bot token from @BotFather
#   TELEGRAM_ALERT_CHAT_ID    — target chat (numeric id or @username)
# TUNABLE ENV (defaults shown)
#   NGINX_5XX_THRESHOLD=20     — events in the window that trigger an alert
#   NGINX_WINDOW_SECONDS=60    — sliding window size, in seconds
#   NGINX_ACCESS_LOG=/var/log/nginx/access.log
#   NGINX_THROTTLE_SECONDS=60  — minimum seconds between two Telegram POSTs
#
# GRACEFUL DEGRADATION
#   Missing token / chat → the script logs a single message to stderr and
#   stays alive doing the tail (so logs are exercised but no POST happens).
#   This matches the API-side behaviour: never crash if Telegram is unconfigured.
#
# nginx LOG FORMAT
#   We assume the default `combined` access log:
#     remote $remote_user [time_local] "method path http" status bytes ...
#   Status is field #9 in `combined` (awk's $9). If you customise log_format,
#   adjust STATUS_FIELD/PATH_FIELD below.
# =============================================================================

set -eu

LOG_FILE="${NGINX_ACCESS_LOG:-/var/log/nginx/access.log}"
THRESHOLD="${NGINX_5XX_THRESHOLD:-20}"
WINDOW="${NGINX_WINDOW_SECONDS:-60}"
THROTTLE="${NGINX_THROTTLE_SECONDS:-60}"
TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT="${TELEGRAM_ALERT_CHAT_ID:-}"
STATE_FILE="${STATE_FILE:-/tmp/nginx-watchdog.state}"
LAST_ALERT_FILE="${LAST_ALERT_FILE:-/tmp/nginx-watchdog.lastalert}"

# combined format field positions:
STATUS_FIELD=9
PATH_FIELD=7   # "METHOD path HTTP/1.1" → quoted token #6; after awk splits on
               # whitespace the path itself sits at $7 (the quote is at $6).

log() { printf '[watchdog] %s\n' "$*" >&2; }

# Validate that we have a working enough environment. We DO NOT exit on missing
# Telegram creds — we degrade to a tail-only loop so the sidecar still proves
# the log volume is mounted correctly and so adding the secret later only
# requires a restart, not a redeploy.
if [ -z "$TOKEN" ] || [ -z "$CHAT" ]; then
  log "TELEGRAM_BOT_TOKEN / TELEGRAM_ALERT_CHAT_ID not set — alerts DISABLED."
  log "Tailing $LOG_FILE in passive mode (no Telegram POST). Set both env vars and restart to enable."
  TELEGRAM_DISABLED=1
else
  TELEGRAM_DISABLED=0
fi

# Wait for the log file to exist before tailing — on a fresh deploy nginx may
# not have served a request yet. `tail -F` would create the file otherwise,
# which we want to avoid (it would mask a misconfigured volume mount).
ATTEMPT=0
while [ ! -f "$LOG_FILE" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  if [ "$ATTEMPT" -gt 60 ]; then
    log "Access log $LOG_FILE not present after 60 attempts — staying alive but no input."
    break
  fi
  sleep 2
done

: > "$STATE_FILE"
: > "$LAST_ALERT_FILE"

# Send a Markdown-V2 message to Telegram. Returns 0 on success, non-zero on
# failure. Always returns quickly (curl --max-time 5).
send_telegram() {
  text="$1"
  if [ "$TELEGRAM_DISABLED" = "1" ]; then return 0; fi
  curl --silent --show-error --max-time 5 \
    -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
    -H 'content-type: application/json' \
    --data "$(printf '{"chat_id":"%s","text":%s,"parse_mode":"MarkdownV2","disable_web_page_preview":true}' \
      "$CHAT" "$(printf '%s' "$text" | awk 'BEGIN{ORS=""; print "\""} {gsub(/\\/,"\\\\"); gsub(/"/,"\\\""); gsub(/\n/,"\\n"); print} END{print "\""}')")" \
    > /dev/null || log "curl POST failed (non-fatal)"
}

# Escape MarkdownV2 metacharacters in a literal — applied to the timestamp +
# threshold integers we interpolate into the message. Mirrors the API-side
# escapeMarkdownV2() so a future operator copy-pastes between alerts cleanly.
escape_mdv2() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' \
    -e 's/_/\\_/g' -e 's/\*/\\*/g' -e 's/\[/\\[/g' -e 's/\]/\\]/g' \
    -e 's/(/\\(/g' -e 's/)/\\)/g' -e 's/~/\\~/g' -e 's/`/\\`/g' \
    -e 's/>/\\>/g' -e 's/#/\\#/g' -e 's/+/\\+/g' -e 's/-/\\-/g' \
    -e 's/=/\\=/g' -e 's/|/\\|/g' -e 's/{/\\{/g' -e 's/}/\\}/g' \
    -e 's/\./\\./g' -e 's/!/\\!/g'
}

# Recompute the live window: drop rows older than NOW-WINDOW, count what's
# left, and (when threshold is crossed AND throttle has elapsed) POST.
maybe_alert() {
  now="$(date +%s)"
  cutoff=$((now - WINDOW))
  # Rewrite STATE_FILE atomically: stream through awk keeping in-window rows.
  awk -v cutoff="$cutoff" '$1 >= cutoff' "$STATE_FILE" > "${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
  count="$(wc -l < "$STATE_FILE" | tr -d ' ')"

  if [ "$count" -ge "$THRESHOLD" ]; then
    # Throttle: at most one alert per NGINX_THROTTLE_SECONDS.
    last="$(cat "$LAST_ALERT_FILE" 2>/dev/null || echo 0)"
    elapsed=$((now - last))
    if [ "$elapsed" -lt "$THROTTLE" ]; then
      return 0
    fi
    # Top 3 paths in the window — `sort | uniq -c | sort -rn` is the classic
    # tally; we trim to 3 lines for the Telegram message.
    top_paths="$(awk '{print $2}' "$STATE_FILE" | sort | uniq -c | sort -rn | head -3 \
      | awk '{ $1=$1; printf "%s (%s)\n", $2, $1 }')"
    title="$(escape_mdv2 "$count")"
    win="$(escape_mdv2 "$WINDOW")"
    msg="*🚨 nginx 5xx burst*
${title} events in last ${win}s
*top paths:*"
    # Append each top path as an escaped bullet.
    OLDIFS="$IFS"; IFS='
'
    for p in $top_paths; do
      esc="$(escape_mdv2 "$p")"
      msg="${msg}
• \`${esc}\`"
    done
    IFS="$OLDIFS"
    send_telegram "$msg"
    echo "$now" > "$LAST_ALERT_FILE"
    # Drain the window after firing so we don't immediately re-alert on the same
    # rows (the next threshold crossing must accumulate fresh events).
    : > "$STATE_FILE"
  fi
}

# Main loop: tail -F handles log rotation; for each incoming line, if it
# matches a 5xx status, append (timestamp, path) to STATE_FILE and re-evaluate.
# The `|| true` keeps the pipeline alive if tail momentarily errors (e.g.
# during a logrotate).
log "Starting nginx-watchdog: threshold=${THRESHOLD} events / window=${WINDOW}s, log=${LOG_FILE}"
tail -n0 -F "$LOG_FILE" 2>/dev/null | \
while IFS= read -r line; do
  # Extract status + path with awk. Default combined format → field 9 is status.
  status="$(printf '%s' "$line" | awk -v sf="$STATUS_FIELD" '{print $sf}')"
  case "$status" in
    5[0-9][0-9])
      path="$(printf '%s' "$line" | awk -v pf="$PATH_FIELD" '{print $pf}')"
      # Path defaults to '-' if extraction failed so the tally never crashes.
      [ -n "$path" ] || path='-'
      printf '%s %s\n' "$(date +%s)" "$path" >> "$STATE_FILE"
      maybe_alert || true
      ;;
    *) : ;;
  esac
done
