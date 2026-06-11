#!/usr/bin/env bash
# =============================================================================
# bootstrap.sh — ONE-COMMAND production deploy for ruletka.top
# -----------------------------------------------------------------------------
# Brings up the WHOLE stack on a fresh Debian/Ubuntu VPS (e.g. Timeweb
# 186.246.9.90): Docker, the 3-node Mongo replica set, Redis, coturn (TURN+TLS),
# 2× API, web, the admin SPA, and nginx terminating HTTPS for all subdomains —
# plus the Let's Encrypt certificate and auto-renewal. Idempotent.
#
# DNS for ruletka.top / www / api / admin / turn must already point at this host,
# and :80/:443 must be free (mail is external Timeweb MX — nothing mail here).
#
# ── Run it (as root on the server). Provide SMTP_PASS + the TWO Turnstile keys
#    (TURNSTILE_SECRET + TURNSTILE_SITE_KEY — both prod-required); everything
#    else is auto-generated:
#
#   # If the repo is PUBLIC:
#   SMTP_PASS='your-smtp-pass' \
#   TURNSTILE_SECRET='your-turnstile-secret' TURNSTILE_SITE_KEY='your-site-key' \
#   bash -c \
#     'git clone https://github.com/van4xx/ruletkaTop.git /opt/ruletka \
#      && cd /opt/ruletka && bash infra/deploy/bootstrap.sh'
#
#   # If the repo is PRIVATE (use a read-only GitHub token):
#   SMTP_PASS='your-smtp-pass' \
#   TURNSTILE_SECRET='your-turnstile-secret' TURNSTILE_SITE_KEY='your-site-key' \
#   RULETKA_REPO='https://x-access-token:GH_TOKEN@github.com/van4xx/ruletkaTop.git' \
#   bash -c 'git clone "$RULETKA_REPO" /opt/ruletka && cd /opt/ruletka \
#            && bash infra/deploy/bootstrap.sh'
#
# REQUIRED secrets the operator MUST supply (the script prompts if a TTY,
# otherwise it aborts — all three gate user-facing flows the prod app cannot
# meaningfully open without):
#   • SMTP_PASS          — Timeweb SMTP password for no-reply@ruletka.top.
#   • TURNSTILE_SECRET   — Cloudflare Turnstile SERVER secret. The anti-bot gate
#                          on /auth/register; the API REFUSES TO BOOT in prod
#                          without it (config-validation CRITICAL_SECRETS +
#                          LAUNCH-CHECKLIST). Cloudflare dash → Turnstile → Secret.
#   • TURNSTILE_SITE_KEY — Cloudflare Turnstile PUBLIC site key. Baked into the
#                          web build as NEXT_PUBLIC_TURNSTILE_SITE_KEY (compose
#                          build-arg). Without it the widget renders NOTHING and
#                          every signup is 400-rejected by the API (paired-secret
#                          mismatch). Same Cloudflare widget → Site key.
#
# AUTO-GENERATED secrets (you never see/handle these — written into .env once,
# AND self-healed on every subsequent run if the file is missing a key that the
# code newly requires — see `upsert_env` below):
#   JWT_ACCESS/REFRESH_SECRET, REDIS_PASSWORD, TURN_STATIC_AUTH_SECRET, the VAPID
#   keypair, METRICS_TOKEN (bearer for /api/metrics — the API fails-fast on a
#   blank one in prod), and the Mongo root + least-privilege app passwords + the
#   replica-set keyFile (infra/secrets/mongo-keyfile).
#
# Optional env (default to a clean no-op): SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN,
# ANALYTICS_DOMAIN, ANALYTICS_HOST, ADMIN_EMAIL (promote to admin), ACME_EMAIL,
# RULETKA_REPO.
# =============================================================================
set -euo pipefail

REPO_URL="${RULETKA_REPO:-https://github.com/van4xx/ruletkaTop.git}"
INSTALL_DIR="${RULETKA_DIR:-/opt/ruletka}"
ACME_EMAIL="${ACME_EMAIL:-admin@ruletka.top}"
DOMAINS=(ruletka.top www.ruletka.top api.ruletka.top admin.ruletka.top turn.ruletka.top)

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ── 0. Locate (or clone) the repo ────────────────────────────────────────────
SELF_SRC="${BASH_SOURCE[0]:-}"
if [ -n "$SELF_SRC" ] && [ -f "$(cd "$(dirname "$SELF_SRC")/../.." 2>/dev/null && pwd)/infra/docker/docker-compose.prod.yml" ]; then
  ROOT_DIR="$(cd "$(dirname "$SELF_SRC")/../.." && pwd)"
else
  say "Fetching the repo into ${INSTALL_DIR}…"
  have git || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git ca-certificates; }
  if [ -d "$INSTALL_DIR/.git" ]; then git -C "$INSTALL_DIR" pull --ff-only || true
  else git clone "$REPO_URL" "$INSTALL_DIR"; fi
  ROOT_DIR="$INSTALL_DIR"
fi
cd "$ROOT_DIR"
COMPOSE="docker compose --env-file .env -f infra/docker/docker-compose.prod.yml"
getenv() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }

# ── 0a. Self-healing env helper ─────────────────────────────────────────────
# upsert_env KEY VALUE: idempotently ensure `KEY=VALUE` exists in .env.
#   • Uses the documented `sed delete + echo append` pattern (the same pattern
#     ENV_CHECKLIST.md tells operators to use), so the file remains the single
#     source of truth.
#   • Touches .env first so a stale `if [ ! -f .env ]` guard cannot block us
#     on a fresh install (we create-then-fill, instead of the old
#     gate-then-write pattern that silently skipped NEWLY-required secrets
#     when an older .env was already on disk — root cause of today's missing
#     METRICS_TOKEN + MONGO_* failure).
upsert_env() {
  local key="$1"; local val="$2"
  [ -n "$key" ] || die "upsert_env: empty KEY"
  touch .env
  chmod 600 .env 2>/dev/null || true
  # Delete any existing line(s) for this key, then append the canonical value.
  sed -i.bak "/^${key}=/d" .env 2>/dev/null && rm -f .env.bak
  printf '%s=%s\n' "$key" "$val" >> .env
}

# Wrap openssl so a missing binary is a CLEAR, actionable failure rather than
# silent empty secrets that the API then crash-loops on.
gen_hex() {
  local bytes="$1"
  have openssl || die "openssl not found — install it (apt-get install -y openssl) and re-run. It is required to generate JWT/Mongo/Redis/TURN secrets."
  openssl rand -hex "$bytes"
}
gen_base64() {
  local bytes="$1"
  have openssl || die "openssl not found — install it (apt-get install -y openssl) and re-run."
  openssl rand -base64 "$bytes"
}

# ── 1. Docker ────────────────────────────────────────────────────────────────
if ! have docker; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"

# ── 2. :80/:443 must be free for nginx ──────────────────────────────────────
if ss -tlnp 2>/dev/null | grep -E ':(80|443) ' | grep -vq 'docker\|nginx'; then
  warn "Something already listens on :80/:443 — free it or nginx won't bind:"
  ss -tlnp | grep -E ':(80|443) ' || true
  sleep 4
fi

# ── 3. Secrets / .env (FIRST-RUN heredoc + every-run self-heal) ─────────────
# Strategy: generate the full canonical .env ONCE on the very first deploy
# (preserves the prior behaviour); on every subsequent deploy, run the
# `upsert_env` self-heal pass below to ADD any key the code newly requires
# without disturbing existing values. This is the fix for today's failure
# class — METRICS_TOKEN / MONGO_* were added to bootstrap AFTER the first
# install, and the `if [ ! -f .env ]` guard meant they never landed on the box.

if [ ! -f .env ]; then
  say "Generating .env (one-time)…"
  SMTP_PASS="${SMTP_PASS:-}"
  if [ -z "$SMTP_PASS" ] && [ -t 0 ]; then
    read -rsp "SMTP password for no-reply@ruletka.top (smtp.timeweb.ru): " SMTP_PASS; echo
  fi
  [ -n "$SMTP_PASS" ] || die "SMTP_PASS not provided. Re-run with: SMTP_PASS='…' bash …/bootstrap.sh"

  # TURNSTILE_SECRET — see header. Required.
  TURNSTILE_SECRET="${TURNSTILE_SECRET:-}"
  if [ -z "$TURNSTILE_SECRET" ] && [ -t 0 ]; then
    read -rsp "Cloudflare Turnstile SECRET key (anti-bot gate — required in prod): " TURNSTILE_SECRET; echo
  fi
  [ -n "$TURNSTILE_SECRET" ] || die "TURNSTILE_SECRET not provided. It is REQUIRED in production (the API refuses to boot without it). Get it from Cloudflare → Turnstile → Secret key, then re-run with: TURNSTILE_SECRET='…' TURNSTILE_SITE_KEY='…' bash …/bootstrap.sh"

  # TURNSTILE_SITE_KEY — see header. Required.
  TURNSTILE_SITE_KEY="${TURNSTILE_SITE_KEY:-}"
  if [ -z "$TURNSTILE_SITE_KEY" ] && [ -t 0 ]; then
    read -rp "Cloudflare Turnstile SITE key (public widget key — required in prod): " TURNSTILE_SITE_KEY
  fi
  [ -n "$TURNSTILE_SITE_KEY" ] || die "TURNSTILE_SITE_KEY not provided. It is REQUIRED in production (without it the register-form widget hides and every signup is 400-rejected by the API). Get it from Cloudflare → Turnstile → Site key (same widget as the secret), then re-run with: TURNSTILE_SECRET='…' TURNSTILE_SITE_KEY='…' bash …/bootstrap.sh"

  PUBLIC_IP="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null \
            || curl -fsS --max-time 8 https://ifconfig.me 2>/dev/null \
            || hostname -I 2>/dev/null | awk '{print $1}' || true)"

  # ── Mongo auth secrets (prod RS runs with --auth --keyFile) ────────────────
  say "Generating the Mongo replica-set keyFile + auth passwords…"
  MONGO_ROOT_USERNAME="root"
  MONGO_ROOT_PASSWORD="$(gen_hex 24)"
  MONGO_APP_USERNAME="app"
  MONGO_APP_PASSWORD="$(gen_hex 24)"
  KEYFILE_PATH="$ROOT_DIR/infra/secrets/mongo-keyfile"
  if [ ! -f "$KEYFILE_PATH" ]; then
    mkdir -p "$(dirname "$KEYFILE_PATH")"
    gen_base64 756 > "$KEYFILE_PATH"
    chmod 400 "$KEYFILE_PATH"
    chown 999:999 "$KEYFILE_PATH" 2>/dev/null || true
    echo "keyFile written to infra/secrets/mongo-keyfile (chmod 400)."
  else
    echo "Mongo keyFile already present — reusing it."
  fi
  MONGODB_URI_PROD="mongodb://${MONGO_APP_USERNAME}:${MONGO_APP_PASSWORD}@mongo1:27017,mongo2:27017,mongo3:27017/ruletka?replicaSet=rs0&authSource=ruletka&retryWrites=true&w=majority"

  # VAPID keypair for Web Push (generated in a throwaway node container — no host node needed).
  say "Generating VAPID keys…"
  VAPID_JSON="$(docker run --rm node:20-alpine sh -c 'npm i -g web-push@3 >/dev/null 2>&1 && web-push generate-vapid-keys --json' 2>/dev/null || echo '{}')"
  VAPID_PUB="$(printf '%s' "$VAPID_JSON"  | sed -n 's/.*"publicKey":"\([^"]*\)".*/\1/p')"
  VAPID_PRIV="$(printf '%s' "$VAPID_JSON" | sed -n 's/.*"privateKey":"\([^"]*\)".*/\1/p')"

  cat > .env <<EOF
NODE_ENV=production
API_PORT=4000
API_HOST=0.0.0.0
API_GLOBAL_PREFIX=api
CORS_ORIGINS=https://ruletka.top,https://www.ruletka.top,https://admin.ruletka.top
COOKIE_DOMAIN=.ruletka.top
MONGODB_URI=${MONGODB_URI_PROD}
MONGO_ROOT_USERNAME=${MONGO_ROOT_USERNAME}
MONGO_ROOT_PASSWORD=${MONGO_ROOT_PASSWORD}
MONGO_APP_USERNAME=${MONGO_APP_USERNAME}
MONGO_APP_PASSWORD=${MONGO_APP_PASSWORD}
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$(gen_hex 24)
JWT_ACCESS_SECRET=$(gen_hex 48)
JWT_ACCESS_TTL=900s
JWT_REFRESH_SECRET=$(gen_hex 48)
JWT_REFRESH_TTL=30d
ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2
TURN_HOST=turn.ruletka.top
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_REALM=ruletka.top
TURN_STATIC_AUTH_SECRET=$(gen_hex 32)
TURN_CRED_TTL_SECONDS=1200
TURN_EXTERNAL_IP=${PUBLIC_IP}
SMTP_HOST=smtp.timeweb.ru
SMTP_PORT=465
SMTP_USER=no-reply@ruletka.top
SMTP_PASS="${SMTP_PASS}"
MAIL_FROM="Рулетка <no-reply@ruletka.top>"
WEB_BASE_URL=https://ruletka.top
VAPID_PUBLIC_KEY=${VAPID_PUB}
VAPID_PRIVATE_KEY=${VAPID_PRIV}
VAPID_SUBJECT=mailto:admin@ruletka.top
TURNSTILE_SECRET=${TURNSTILE_SECRET}
METRICS_TOKEN=$(gen_hex 32)
SENTRY_DSN=${SENTRY_DSN:-}
NEXT_PUBLIC_API_URL=https://api.ruletka.top/api
NEXT_PUBLIC_WS_URL=https://api.ruletka.top
NEXT_PUBLIC_STUN_URLS=stun:turn.ruletka.top:3478
NEXT_PUBLIC_TURN_URLS=turn:turn.ruletka.top:3478,turns:turn.ruletka.top:5349
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${VAPID_PUB}
NEXT_PUBLIC_TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY:-}
NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN:-${SENTRY_DSN:-}}
NEXT_PUBLIC_ANALYTICS_DOMAIN=${ANALYTICS_DOMAIN:-}
NEXT_PUBLIC_ANALYTICS_HOST=${ANALYTICS_HOST:-}
NEXT_PUBLIC_ASSET_PREFIX=${ASSET_PREFIX:-}
VITE_API_URL=https://api.ruletka.top/api
EOF
  chmod 600 .env
  echo ".env written (chmod 600)."
else
  say ".env already present — running self-heal pass for any newly-required keys."
fi

# ── 3a. SELF-HEAL: ensure every code-required secret exists in .env ─────────
# Runs UNCONDITIONALLY (fresh or pre-existing .env). For each required key:
#   • if missing/empty → generate (or default) and upsert
#   • if present       → leave the operator's value alone (idempotent)
# This is the fix for today's class of failure: the old `if [ ! -f .env ]`
# guard meant secrets ADDED to bootstrap.sh later (METRICS_TOKEN; the four
# MONGO_* vars) were never written on already-deployed servers, and the API +
# mongo-init then crash-looped on the missing env. The upsert pass closes
# that whole class — adding a new required secret in code only needs an
# upsert_env line here for it to land on every existing server on next deploy.

say "Self-healing required secrets in .env…"

current_value() {
  # Reads a key from .env, or empty if absent. Trims trailing CR/whitespace.
  grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' | sed 's/[[:space:]]*$//'
}

# METRICS_TOKEN — bearer guarding GET /api/metrics. API fails-fast on blank in
# prod (MetricsTokenGuard). Was missing on servers installed before this var
# became required — auto-generate now.
if [ -z "$(current_value METRICS_TOKEN)" ]; then
  warn "METRICS_TOKEN missing — generating one (openssl rand -hex 32)…"
  upsert_env METRICS_TOKEN "$(gen_hex 32)"
fi

# Mongo auth — root + app users + passwords. Without these the prod compose
# file's `${MONGO_*:?…}` checks abort `up`, AND the mongo image never creates
# the root user, so even the localhost-exception bootstrap below cannot
# authenticate downstream. Defaults match what we hand-rolled today.
if [ -z "$(current_value MONGO_ROOT_USERNAME)" ]; then
  warn "MONGO_ROOT_USERNAME missing — defaulting to 'root'."
  upsert_env MONGO_ROOT_USERNAME "root"
fi
if [ -z "$(current_value MONGO_ROOT_PASSWORD)" ]; then
  warn "MONGO_ROOT_PASSWORD missing — generating one (openssl rand -hex 24)…"
  upsert_env MONGO_ROOT_PASSWORD "$(gen_hex 24)"
fi
if [ -z "$(current_value MONGO_APP_USERNAME)" ]; then
  warn "MONGO_APP_USERNAME missing — defaulting to 'app'."
  upsert_env MONGO_APP_USERNAME "app"
fi
if [ -z "$(current_value MONGO_APP_PASSWORD)" ]; then
  warn "MONGO_APP_PASSWORD missing — generating one (openssl rand -hex 24)…"
  upsert_env MONGO_APP_PASSWORD "$(gen_hex 24)"
fi

# MONGODB_URI — rebuild it whenever it's empty OR still pointing at the dev
# directConnection format (single host, no replicaSet) OR references a
# username that no longer matches the current MONGO_APP_USERNAME. We use the
# canonical multi-host RS URI with authSource=ruletka.
MONGO_APP_USERNAME_VAL="$(current_value MONGO_APP_USERNAME)"
MONGO_APP_PASSWORD_VAL="$(current_value MONGO_APP_PASSWORD)"
MONGODB_URI_CURRENT="$(current_value MONGODB_URI)"
need_uri_rebuild=0
if [ -z "$MONGODB_URI_CURRENT" ]; then need_uri_rebuild=1
elif printf '%s' "$MONGODB_URI_CURRENT" | grep -q 'directConnection=true'; then need_uri_rebuild=1
elif ! printf '%s' "$MONGODB_URI_CURRENT" | grep -q 'replicaSet=rs0'; then need_uri_rebuild=1
elif [ -n "$MONGO_APP_USERNAME_VAL" ] && ! printf '%s' "$MONGODB_URI_CURRENT" | grep -q "://${MONGO_APP_USERNAME_VAL}:"; then need_uri_rebuild=1
fi
if [ "$need_uri_rebuild" = "1" ]; then
  warn "MONGODB_URI missing or uses dev format — rebuilding canonical replica-set URI."
  NEW_URI="mongodb://${MONGO_APP_USERNAME_VAL}:${MONGO_APP_PASSWORD_VAL}@mongo1:27017,mongo2:27017,mongo3:27017/ruletka?replicaSet=rs0&authSource=ruletka&retryWrites=true&w=majority"
  upsert_env MONGODB_URI "$NEW_URI"
fi

# ── 3b. PRE-FLIGHT critical-secret check ────────────────────────────────────
# Some secrets cannot be auto-generated (operator-only: Turnstile). The fresh
# heredoc above prompts for them on a TTY; this guard catches the OTHER case —
# an existing .env on a non-interactive shell where one of those secrets is
# blank because the previous bootstrap was killed before it landed. We abort
# loudly rather than letting the API crash-loop on a blank CRITICAL_SECRET.
#
# CRITICAL_SECRETS = the API's config-validation list that fails-fast at boot.
# Adding to this set?  Append the key here AND list it as an operator-supplied
# secret in SECRETS-INSTALL.md.
CRITICAL_SECRETS=(TURNSTILE_SECRET)
missing_critical=()
for k in "${CRITICAL_SECRETS[@]}"; do
  if [ -z "$(current_value "$k")" ]; then
    # Heredoc above will have prompted on TTY for a fresh deploy; if we still
    # land here it's an already-deployed server with a blank secret.
    if [ -t 0 ]; then
      case "$k" in
        TURNSTILE_SECRET)
          read -rsp "Cloudflare Turnstile SECRET key (required — paste now): " v; echo
          ;;
        *)
          read -rsp "$k (required): " v; echo
          ;;
      esac
      if [ -n "$v" ]; then
        upsert_env "$k" "$v"
      else
        missing_critical+=("$k")
      fi
    else
      missing_critical+=("$k")
    fi
  fi
done
if [ "${#missing_critical[@]}" -gt 0 ]; then
  die "Critical secret(s) blank in .env on a non-interactive shell: ${missing_critical[*]}. Re-run bootstrap INTERACTIVELY so you can paste them (or pre-populate .env), then retry. The API will not boot without these — see infra/deploy/SECRETS-INSTALL.md."
fi

chmod 600 .env

# ── 3c. Safety net: the prod Mongo nodes mount infra/secrets/mongo-keyfile and
#       will NOT start without it. On the happy path it was generated alongside
#       .env above; guard the edge case where .env exists but the keyFile is
#       missing (e.g. infra/secrets was wiped) so we fail with a clear message
#       instead of an opaque mongod boot error. ────────────────────────────────
KEYFILE_PATH="$ROOT_DIR/infra/secrets/mongo-keyfile"
if [ ! -f "$KEYFILE_PATH" ]; then
  warn "Mongo keyFile missing at infra/secrets/mongo-keyfile — regenerating it."
  mkdir -p "$(dirname "$KEYFILE_PATH")"
  gen_base64 756 > "$KEYFILE_PATH"
  chmod 400 "$KEYFILE_PATH"
  chown 999:999 "$KEYFILE_PATH" 2>/dev/null || true
fi

# ── 4. Build shared-types + the admin SPA (in a container; nginx serves dist) ─
say "Building @ruletka/shared-types + the admin SPA (containerised — no host Node)…"
API_URL="$(getenv NEXT_PUBLIC_API_URL)"; API_URL="${API_URL:-https://api.ruletka.top/api}"
docker run --rm -v "$ROOT_DIR":/app -w /app -e VITE_API_URL="$API_URL" node:20 bash -lc '
  corepack enable &&
  pnpm install --frozen-lockfile &&
  pnpm --filter @ruletka/shared-types build &&
  pnpm --filter @ruletka/admin build
'
[ -f apps/admin/dist/index.html ] || die "admin build did not produce apps/admin/dist"

# ── 5. TLS certificate (one cert, all five names) — issue if absent ─────────
if ! docker run --rm -v ruletka-letsencrypt:/etc/letsencrypt alpine \
      test -f /etc/letsencrypt/live/ruletka.top/fullchain.pem 2>/dev/null; then
  say "Issuing the Let's Encrypt certificate (standalone; needs :80 free ~30s)…"
  $COMPOSE stop nginx 2>/dev/null || true   # free :80 if a prior nginx holds it
  CERT_ARGS=(); for d in "${DOMAINS[@]}"; do CERT_ARGS+=(-d "$d"); done
  docker run --rm -p 80:80 \
    -v ruletka-letsencrypt:/etc/letsencrypt -v ruletka-certbot-webroot:/var/www/certbot \
    certbot/certbot certonly --standalone --non-interactive --agree-tos -m "$ACME_EMAIL" \
    "${CERT_ARGS[@]}" || die "Certificate issuance failed (check DNS → this host + that :80 is reachable)."
else
  say "TLS certificate already present — reusing it."
fi

# ── 6. Build + start the whole stack ────────────────────────────────────────
say "Building images + starting the stack (Mongo RS · Redis · coturn · API×2 · web · nginx · certbot)…"
$COMPOSE up -d --build

# ── 6a. MONGO LOCALHOST-EXCEPTION USER BOOTSTRAP ────────────────────────────
# Today's failure mode: mongo nodes came up with `--auth --keyFile` but for
# whatever reason (mid-deploy crash, MONGO_INITDB_ROOT_* missing on first init
# because .env predated those vars) the ROOT user was never created on the
# admin db. With auth on and no root, mongo-init cannot authenticate → it
# loops forever → the api hits "Authentication failed" on every boot attempt.
#
# Fix: as soon as mongo1 answers, check whether the `admin` db has ANY users.
# If not, use the localhost-exception (the first user can be created without
# auth, locally, before any auth user exists) to create root + the app user.
# Once `admin.system.users` has rows, the exception closes — re-running this
# step is a clean no-op. This is the exact recovery we ran by hand today,
# made idempotent and automatic.
say "Verifying mongo1 has authenticated users (localhost-exception bootstrap if not)…"
MONGO_ROOT_USERNAME_VAL="$(current_value MONGO_ROOT_USERNAME)"
MONGO_ROOT_PASSWORD_VAL="$(current_value MONGO_ROOT_PASSWORD)"
MONGO_APP_USERNAME_VAL="$(current_value MONGO_APP_USERNAME)"
MONGO_APP_PASSWORD_VAL="$(current_value MONGO_APP_PASSWORD)"

# Wait up to 60s for mongo1 to answer `ping` — even unauthenticated, ping
# works at the wire-protocol level so this is a pure liveness check.
mongo_ready=0
for _ in $(seq 1 30); do
  if docker exec ruletka-mongo1 mongosh --quiet --eval "db.adminCommand('ping').ok" >/dev/null 2>&1; then
    mongo_ready=1; break
  fi
  sleep 2
done
if [ "$mongo_ready" != "1" ]; then
  warn "mongo1 did not answer ping in 60s — skipping user-bootstrap check; mongo-init may recover."
else
  # Probe order:
  #   1) Try the unauthenticated count. Returns "0" if users-collection empty
  #      AND the connection allowed it (which only happens via the localhost
  #      exception while there are no users). Returns "AUTH_ENFORCED" if auth
  #      rejected the read — meaning users DO exist.
  #   2) If we got a non-zero number → users exist (rare but possible if the
  #      probe ran inside the localhost exception while the image entrypoint
  #      had just created the root user). Verify root auth and we're done.
  #   3) Only "0" → no users → run the localhost-exception bootstrap.
  user_count_output="$(docker exec ruletka-mongo1 mongosh admin --quiet --eval 'try { print(db.system.users.countDocuments({})); } catch (e) { print("AUTH_ENFORCED"); }' 2>/dev/null || true)"
  user_count_output="$(printf '%s' "$user_count_output" | tr -d '\r' | tail -n1 | tr -d '[:space:]')"

  users_already_exist=0
  if [ "$user_count_output" = "AUTH_ENFORCED" ]; then
    users_already_exist=1
  elif [ -n "$user_count_output" ] && [ "$user_count_output" != "0" ]; then
    users_already_exist=1
  fi

  if [ "$users_already_exist" = "1" ]; then
    # Confirm root credentials in .env still match what's on disk. If they
    # don't, the mismatch is a manual rotation problem — do NOT silently
    # overwrite, because that would corrupt an authenticated cluster.
    if docker exec ruletka-mongo1 mongosh admin --quiet \
         -u "$MONGO_ROOT_USERNAME_VAL" -p "$MONGO_ROOT_PASSWORD_VAL" \
         --authenticationDatabase admin --eval "db.runCommand({connectionStatus:1}).ok" \
         >/dev/null 2>&1; then
      echo "  • admin users already exist (root authenticates OK) — skipping bootstrap."
    else
      warn "admin db has users but root authentication FAILED — .env passwords likely diverged from on-disk users. See ENV_CHECKLIST.md → Mongo section for the rotate runbook."
    fi
  elif [ "$user_count_output" = "0" ]; then
    warn "admin db has zero users — bootstrapping root + app via localhost-exception."
    # Mirror the exact mongosh script we ran manually today.
    docker exec -i ruletka-mongo1 mongosh --quiet <<EOF || die "Failed to bootstrap Mongo root/app users via localhost-exception."
const root_user = "${MONGO_ROOT_USERNAME_VAL}";
const root_pw   = "${MONGO_ROOT_PASSWORD_VAL}";
const app_user  = "${MONGO_APP_USERNAME_VAL}";
const app_pw    = "${MONGO_APP_PASSWORD_VAL}";

const admin = db.getSiblingDB("admin");
if (admin.system.users.countDocuments({user: root_user}) === 0) {
  admin.createUser({
    user: root_user,
    pwd:  root_pw,
    roles: [
      { role: "root", db: "admin" }
    ]
  });
  print("root user created via localhost-exception");
} else {
  print("root user already present");
}

const adb = db.getSiblingDB("ruletka");
if (adb.system.users.countDocuments({user: app_user}) === 0) {
  adb.createUser({
    user: app_user,
    pwd:  app_pw,
    roles: [
      { role: "readWrite", db: "ruletka" },
      { role: "dbAdmin",   db: "ruletka" }
    ]
  });
  print("app user created via localhost-exception");
} else {
  print("app user already present");
}
EOF
    echo "  • Mongo users bootstrapped — mongo-init can now authenticate."
  else
    # Empty / unparseable output → couldn't determine state. Don't take any
    # destructive action; mongo-init will retry the rs.initiate() loop and
    # surface the real error in its logs if anything is genuinely broken.
    warn "Could not determine mongo1 user-list state (raw probe output: '$user_count_output'). Leaving the cluster alone; check '$COMPOSE logs mongo-init' if api fails to authenticate."
  fi
fi

# ── 6b. FORCE-RECREATE GUARANTEE for api + web ──────────────────────────────
# Today's failure mode: after `up -d --build` the containers ended up REMOVED
# without being re-created (likely an OOM kill or a transient docker-compose
# bug). nginx then resolved `api`/`web` to "host not found" and every request
# 502'd. Fix: after the global `up`, explicitly poll for both running services
# and force-recreate if either is missing.
#
# We accept either single-replica or scale=N (containers named …-api-1 …-api-2).
ensure_running() {
  local svc="$1"
  # Count running containers of this compose service. Without --filter the ps
  # output also shows Exited; we limit to running ones explicitly.
  local running
  running="$($COMPOSE ps --status running --services 2>/dev/null | grep -cx "$svc" || true)"
  if [ "${running:-0}" -ge 1 ]; then return 0; fi
  return 1
}

say "Verifying api + web containers are Up (force-recreate if not)…"
for _ in $(seq 1 6); do  # 30s grace, 5s steps
  if ensure_running api && ensure_running web; then break; fi
  sleep 5
done
if ! ensure_running api || ! ensure_running web; then
  warn "api or web NOT Up after 30s — forcing recreate (no-deps, --force-recreate)…"
  $COMPOSE up -d --no-deps --force-recreate api web || true
  sleep 5
fi
# Final check — if still missing, abort. Better a loud failure than a 502'd
# silent deploy.
ensure_running api || die "api service still not Up after force-recreate — check '$COMPOSE logs api'."
ensure_running web || die "web service still not Up after force-recreate — check '$COMPOSE logs web'."
echo "  • api + web are Up."

# ── 6c. nginx config + reload (always, every deploy) ────────────────────────
# nginx.conf is a SINGLE-FILE bind-mount: `up -d` does NOT pick up content
# changes (the container keeps the old inode), so a config edit silently never
# applies. Force-recreate nginx ONLY when the file changed since the last
# deploy — avoids a needless ~1s :443 blip on deploys that don't touch nginx.
NGINX_HASH="$(sha256sum infra/nginx/nginx.conf 2>/dev/null | cut -d' ' -f1)"
if [ -n "$NGINX_HASH" ] && [ "$NGINX_HASH" != "$(cat .nginx.conf.hash 2>/dev/null || true)" ]; then
  say "nginx.conf changed → recreating nginx so the new config takes effect…"
  $COMPOSE up -d --no-deps --force-recreate nginx
  printf '%s\n' "$NGINX_HASH" > .nginx.conf.hash
else
  # Even when nginx.conf is unchanged, `up -d --build` above may have RECREATED
  # the api/web containers (new code → new image → new container → NEW Docker
  # network IP). Our upstreams (`server api:4000;` / `server web:3000;`) resolve
  # the hostname ONCE at nginx startup and cache the IP — there is no `resolver`
  # directive — so nginx keeps proxying to the DEAD old IP → intermittent 502
  # Bad Gateway until something reloads it. A graceful reload re-resolves the
  # upstream hostnames with zero downtime, so every deploy self-heals the
  # api/web upstream IPs. (Root cause of "site dies after a deploy".)
  say "Reloading nginx so it re-resolves api/web upstream IPs (containers may have moved)…"
  # ALWAYS test the config first (catches typos before they take down the edge).
  if docker exec ruletka-nginx nginx -t >/dev/null 2>&1; then
    if ! docker exec ruletka-nginx nginx -s reload 2>/dev/null; then
      warn "nginx reload failed once — retrying in 5s after upstream settle…"
      sleep 5
      docker exec ruletka-nginx nginx -s reload 2>/dev/null \
        || $COMPOSE up -d --no-deps --force-recreate nginx
    fi
  else
    warn "nginx -t reported a config error — force-recreating nginx for a clean restart."
    $COMPOSE up -d --no-deps --force-recreate nginx
  fi
fi

say "Waiting for the API to become healthy…"
OK=""
for _ in $(seq 1 40); do
  if curl -fsS --max-time 5 https://api.ruletka.top/api/health >/dev/null 2>&1; then OK=1; echo "API healthy ✓"; break; fi
  sleep 5
done
[ -n "$OK" ] || warn "API not healthy yet — check: $COMPOSE logs -f api"

# ── 7. Promote an admin (optional; pass ADMIN_EMAIL=…) ──────────────────────
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
if [ -z "$ADMIN_EMAIL" ] && [ -t 0 ]; then
  read -rp "Admin email to promote (must be registered first; blank to skip): " ADMIN_EMAIL || true
fi
if [ -n "$ADMIN_EMAIL" ]; then
  MONGO_APP_USER="$(getenv MONGO_APP_USERNAME)"; MONGO_APP_USER="${MONGO_APP_USER:-app}"
  MONGO_APP_PW="$(getenv MONGO_APP_PASSWORD)"
  $COMPOSE exec -T mongo1 mongosh ruletka --quiet \
    -u "$MONGO_APP_USER" -p "$MONGO_APP_PW" --authenticationDatabase ruletka --eval \
    "print(db.users.updateOne({email:'${ADMIN_EMAIL}'},{\$set:{role:'admin'}}).matchedCount ? 'role=admin set for ${ADMIN_EMAIL}' : 'no user ${ADMIN_EMAIL} (register first, then re-run)');" \
    || warn "Could not set admin role (is the user registered? are MONGO_APP_* in .env?)."
fi

# ── 8. Verify ────────────────────────────────────────────────────────────────
say "Smoke test:"
printf '  web    %s → %s\n' "https://ruletka.top"           "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://ruletka.top || echo DOWN)"
printf '  api    %s → %s\n' "https://api.ruletka.top/api/health" "$(curl -s --max-time 8 https://api.ruletka.top/api/health || echo DOWN)"
printf '  admin  %s → %s\n' "https://admin.ruletka.top"     "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://admin.ruletka.top || echo DOWN)"
say "Done. ruletka.top is live."
echo "  • Logs:    $COMPOSE logs -f"
echo "  • Update:  cd $ROOT_DIR && git pull && bash infra/deploy/bootstrap.sh"
echo "  • Admin panel: https://admin.ruletka.top  (promote a user via ADMIN_EMAIL=… re-run)"
echo "  • Secrets:  .env (chmod 600) holds the auto-generated JWT/Redis/TURN/VAPID"
echo "              secrets + METRICS_TOKEN + the Mongo root/app passwords; the"
echo "              Mongo replica-set keyFile is at infra/secrets/mongo-keyfile."
echo "              Both are git-ignored — back them up; do NOT commit them."
