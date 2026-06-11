#!/usr/bin/env sh
# =============================================================================
# cert-watch.sh — daily HTTPS-certificate expiry monitor for ruletka.top
# -----------------------------------------------------------------------------
# Why this exists:
#   The `certbot` sidecar in infra/docker/docker-compose.prod.yml runs `certbot
#   renew` every 12h. If a renewal silently fails (rate-limit, DNS hiccup, ACME
#   challenge regression) we only find out when the cert expires and the apex
#   serves a hard browser warning. This watcher closes that blind spot:
#
#     1. Probes the LIVE listener with openssl s_client and reads the cert's
#        notAfter via `openssl x509 -noout -enddate`. Live TLS is the truth —
#        an on-disk PEM may have been renewed without nginx picking it up
#        (single-file bind-mount; see docker-compose.prod.yml notes), so probing
#        the listener catches that drift too.
#     2. Falls back to /etc/letsencrypt/live/<domain>/cert.pem when the network
#        path fails (DNS, the local edge being down mid-deploy). The PEM is
#        bind-mounted into this container read-only, mirroring the nginx mount.
#     3. Computes `days_left` in UTC and writes it to a small file the API
#        scrapes pull-style to publish the `ruletka_cert_expiry_days{domain}`
#        Prometheus gauge — same `/api/metrics` endpoint already in use, no
#        extra exporter.
#     4. Posts a Telegram alert (bot token + chat id from env) when days_left
#        is below CERT_WATCH_WARNING_DAYS (default 14). The Prometheus gauge
#        is the durable signal; Telegram is the on-call signal that doesn't
#        require a working dashboard at 03:00.
#
# Designed to run under BusyBox `ash` inside the official `nginx:alpine` /
# `alpine` images — no bashisms (no `(( … ))`, no `[[ … ]]`, no `date -d`).
# `date -d "$enddate" +%s` is GNU-only; we parse `notAfter` with `date` flags
# that work on BOTH BusyBox AND GNU coreutils (best-effort), and fall back to
# `openssl x509 -checkend` widths when the parse is uncooperative.
#
# Exit codes:
#   0 — ran; days_left written; alert posted (if needed) and Telegram POST
#       acknowledged. (We intentionally return 0 even on a "broken" probe so a
#       failing cron run is not retried in tight loops; the `-1` sentinel in
#       the file + the alert are the operator signals.)
#   2 — fatal misconfig (CERT_WATCH_DOMAIN empty or required tools missing).
# =============================================================================

set -eu

# ── 0. Inputs ──────────────────────────────────────────────────────────────
DOMAIN="${CERT_WATCH_DOMAIN:-ruletka.top}"
WARNING_DAYS="${CERT_WATCH_WARNING_DAYS:-14}"
PORT="${CERT_WATCH_PORT:-443}"
# Pem fallback path inside the cert-watch container. We bind-mount the same
# letsencrypt volume nginx uses, RO. The default mirrors the production layout.
PEM_FALLBACK="${CERT_WATCH_PEM_FALLBACK:-/etc/letsencrypt/live/${DOMAIN}/cert.pem}"
# Where we drop the integer for the API to scrape. The API's CertExpiryHealth
# reads this file at every /metrics scrape and publishes the gauge. The
# directory is bind-mounted as a SHARED docker volume so both containers see
# the same path.
DAYS_FILE="${CERT_WATCH_DAYS_FILE:-/var/lib/cert-watch/days_left.txt}"
# Telegram alert wiring (both must be set or alerting is a no-op — kept fully
# optional so the metric path still works in environments without a bot).
TG_TOKEN="${TELEGRAM_ALERT_BOT_TOKEN:-}"
TG_CHAT="${TELEGRAM_ALERT_CHAT_ID:-}"

log()  { printf '[cert-watch] %s\n' "$*"; }
warn() { printf '[cert-watch] WARN: %s\n' "$*" >&2; }
die()  { printf '[cert-watch] FATAL: %s\n' "$*" >&2; exit 2; }

[ -n "$DOMAIN" ] || die "CERT_WATCH_DOMAIN is empty — refusing to probe an unknown host."
command -v openssl >/dev/null 2>&1 || die "openssl not found (apk add openssl)."
command -v date    >/dev/null 2>&1 || die "date not found."

# Persist the days_left file under a stable, bind-mountable path.
mkdir -p "$(dirname "$DAYS_FILE")"

# ── 1. Get the notAfter timestamp ──────────────────────────────────────────
# Try LIVE TLS first (truth = what the browser sees). On any failure
# (timeout, refused, DNS) fall back to the on-disk PEM that certbot maintains.
# We never abort on a single source's failure — only when BOTH fail.

get_enddate_live() {
  # Use a 10s connect/read budget so a hung edge can't stall the cron run.
  # `s_client` writes to stdout; `x509 -noout -enddate` extracts the line.
  # `2>/dev/null` swallows the verify chain noise — we only care about the
  # `notAfter=…` line. Empty stdout ⇒ probe failed.
  printf '' | \
    openssl s_client -servername "$DOMAIN" -connect "${DOMAIN}:${PORT}" \
      -timeout 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null \
    | sed -n 's/^notAfter=//p'
}

get_enddate_pem() {
  [ -r "$PEM_FALLBACK" ] || return 1
  openssl x509 -noout -enddate -in "$PEM_FALLBACK" 2>/dev/null \
    | sed -n 's/^notAfter=//p'
}

ENDDATE=""
SOURCE=""
if ENDDATE_LIVE="$(get_enddate_live)" && [ -n "$ENDDATE_LIVE" ]; then
  ENDDATE="$ENDDATE_LIVE"
  SOURCE="live-tls"
elif ENDDATE_PEM="$(get_enddate_pem)" && [ -n "$ENDDATE_PEM" ]; then
  ENDDATE="$ENDDATE_PEM"
  SOURCE="pem-fallback"
  warn "Live TLS probe to ${DOMAIN}:${PORT} failed — read enddate from ${PEM_FALLBACK} instead."
fi

# ── 2. Compute days_left in UTC ────────────────────────────────────────────
# `notAfter=` formats as `Mon DD HH:MM:SS YYYY GMT` (RFC 5280 GMT). We need
# the epoch-seconds delta from `now` to that timestamp. `date -d` is GNU-only;
# BusyBox supports `-D format` BUT not the openssl format directly. We try
# GNU first, then BusyBox `-D '%b %e %H:%M:%S %Y'`, then last resort the
# openssl `-checkend N` bisection — guarantees a usable answer everywhere.

epoch_now() { date -u +%s; }

epoch_from_enddate() {
  enddate="$1"
  # GNU date (Alpine since 3.18 ships busybox; GNU coreutils via `apk add
  # coreutils` is sometimes installed). Try it first.
  if e="$(date -u -d "$enddate" +%s 2>/dev/null)" && [ -n "$e" ]; then
    printf '%s' "$e"; return 0
  fi
  # BusyBox `-D` form. The openssl emits e.g. `Aug 15 12:34:56 2026 GMT`; the
  # double-space between the abbreviated month + 1-digit day in `%b %e` is
  # tolerated by BusyBox.
  if e="$(date -u -D '%b %e %H:%M:%S %Y %Z' -d "$enddate" +%s 2>/dev/null)" && [ -n "$e" ]; then
    printf '%s' "$e"; return 0
  fi
  return 1
}

DAYS_LEFT=""
if [ -n "$ENDDATE" ]; then
  if ENDEPOCH="$(epoch_from_enddate "$ENDDATE")" && [ -n "$ENDEPOCH" ]; then
    NOW="$(epoch_now)"
    # Integer arithmetic in POSIX sh:
    DAYS_LEFT="$(( (ENDEPOCH - NOW) / 86400 ))"
  fi
fi

# Last-resort path: if `date` could not parse the enddate (extremely old
# BusyBox or unexpected locale), bisect with `openssl x509 -checkend SECS`.
# Bounded loop (max ~400 days) so a broken setup cannot spin forever.
if [ -z "$DAYS_LEFT" ] && [ -r "$PEM_FALLBACK" ]; then
  warn "date(1) could not parse '$ENDDATE' — bisecting with openssl x509 -checkend."
  lo=0; hi=400; found=""
  while [ "$lo" -le "$hi" ]; do
    mid=$(( (lo + hi) / 2 ))
    secs=$(( mid * 86400 ))
    if openssl x509 -checkend "$secs" -noout -in "$PEM_FALLBACK" >/dev/null 2>&1; then
      # Still valid at `mid` days from now → push lower bound up.
      found="$mid"; lo=$(( mid + 1 ))
    else
      # Expires within `mid` days → tighten upper bound.
      hi=$(( mid - 1 ))
    fi
  done
  DAYS_LEFT="${found:-0}"
  SOURCE="${SOURCE:-pem-fallback}"
fi

# ── 3. Persist the gauge value ─────────────────────────────────────────────
# `-1` is the explicit "watcher broken" sentinel the API helper honours; an
# alert on `cert_expiry_days < 0` separates "watcher broken" from "cert
# expiring soon" (cert_expiry_days < CERT_WATCH_WARNING_DAYS).
if [ -z "$DAYS_LEFT" ]; then
  warn "Could not determine days-left from EITHER live TLS or the PEM fallback — writing -1."
  printf -- '-1\n' > "$DAYS_FILE"
  # Even when we can't compute days_left, we want to alert ON-CALL — a watcher
  # that has been broken for 3 days IS the failure mode we built this for.
  ALERT_TEXT="⚠️ cert-watch could NOT determine HTTPS cert expiry for ${DOMAIN} — investigate. (live-TLS + PEM fallback both failed.)"
  log "wrote -1 to $DAYS_FILE (broken sentinel)"
else
  printf '%s\n' "$DAYS_LEFT" > "$DAYS_FILE"
  log "${SOURCE}: ${DOMAIN} cert expires in ${DAYS_LEFT} day(s); wrote ${DAYS_FILE}."
  ALERT_TEXT=""
  if [ "$DAYS_LEFT" -lt "$WARNING_DAYS" ]; then
    ALERT_TEXT="⚠️ HTTPS cert expires in ${DAYS_LEFT} days for ${DOMAIN}"
  fi
fi

# ── 4. Telegram alert (optional, no-op when env unset) ────────────────────
if [ -n "$ALERT_TEXT" ]; then
  if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
    if command -v curl >/dev/null 2>&1; then
      # `-fsS` so we surface non-2xx from the Telegram API in the cron mail/log,
      # but `|| true` so a temporary Telegram outage does not fail the whole
      # script — the metric write above is the source of truth.
      curl -fsS --max-time 15 -X POST \
        "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
        --data-urlencode "chat_id=${TG_CHAT}" \
        --data-urlencode "text=${ALERT_TEXT}" \
        --data-urlencode "parse_mode=Markdown" \
        --data-urlencode "disable_web_page_preview=true" \
        >/dev/null || warn "Telegram POST failed (will retry on next cron tick)."
      log "Telegram alert posted: ${ALERT_TEXT}"
    else
      warn "curl not found — skipping Telegram alert. (apk add curl on the cert-watch container.)"
    fi
  else
    warn "TELEGRAM_ALERT_BOT_TOKEN / TELEGRAM_ALERT_CHAT_ID not set — skipping Telegram alert."
  fi
fi

exit 0
