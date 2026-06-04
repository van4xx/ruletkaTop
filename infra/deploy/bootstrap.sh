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
# ── Run it (as root on the server). Fill in SMTP_PASS; everything else is auto:
#
#   # If the repo is PUBLIC:
#   SMTP_PASS='your-smtp-pass' bash -c \
#     'git clone https://github.com/van4xx/ruletkaTop.git /opt/ruletka \
#      && cd /opt/ruletka && bash infra/deploy/bootstrap.sh'
#
#   # If the repo is PRIVATE (use a read-only GitHub token):
#   SMTP_PASS='your-smtp-pass' \
#   RULETKA_REPO='https://x-access-token:GH_TOKEN@github.com/van4xx/ruletkaTop.git' \
#   bash -c 'git clone "$RULETKA_REPO" /opt/ruletka && cd /opt/ruletka \
#            && bash infra/deploy/bootstrap.sh'
#
# Optional env (all default to a clean no-op): TURNSTILE_SITE_KEY,
# TURNSTILE_SECRET, SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN, ANALYTICS_DOMAIN,
# ANALYTICS_HOST, ADMIN_EMAIL (promote to admin), ACME_EMAIL, RULETKA_REPO.
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

# ── 3. Secrets / .env (generated once; never overwritten) ───────────────────
if [ ! -f .env ]; then
  say "Generating .env (one-time)…"
  SMTP_PASS="${SMTP_PASS:-}"
  if [ -z "$SMTP_PASS" ] && [ -t 0 ]; then
    read -rsp "SMTP password for no-reply@ruletka.top (smtp.timeweb.ru): " SMTP_PASS; echo
  fi
  [ -n "$SMTP_PASS" ] || die "SMTP_PASS not provided. Re-run with: SMTP_PASS='…' bash …/bootstrap.sh"

  PUBLIC_IP="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null \
            || curl -fsS --max-time 8 https://ifconfig.me 2>/dev/null \
            || hostname -I 2>/dev/null | awk '{print $1}' || true)"

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
# Parent domain so the refresh + presence cookies are shared across the apex and
# the api subdomain (fixes cross-subdomain presence-marker desync → spurious logouts).
COOKIE_DOMAIN=.ruletka.top
MONGODB_URI=mongodb://mongo1:27017,mongo2:27017,mongo3:27017/ruletka?replicaSet=rs0&retryWrites=true&w=majority
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$(openssl rand -hex 24)
JWT_ACCESS_SECRET=$(openssl rand -hex 48)
JWT_ACCESS_TTL=900s
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_TTL=30d
ARGON2_MEMORY_COST=19456
ARGON2_TIME_COST=2
TURN_HOST=turn.ruletka.top
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_REALM=ruletka.top
TURN_STATIC_AUTH_SECRET=$(openssl rand -hex 32)
TURN_CRED_TTL_SECONDS=1200
TURN_EXTERNAL_IP=${PUBLIC_IP}
# Email — Timeweb SMTP (465 = implicit TLS)
SMTP_HOST=smtp.timeweb.ru
SMTP_PORT=465
SMTP_USER=no-reply@ruletka.top
SMTP_PASS="${SMTP_PASS}"
MAIL_FROM="Рулетка <no-reply@ruletka.top>"
WEB_BASE_URL=https://ruletka.top
# Web Push (auto-generated)
VAPID_PUBLIC_KEY=${VAPID_PUB}
VAPID_PRIVATE_KEY=${VAPID_PRIV}
VAPID_SUBJECT=mailto:admin@ruletka.top
# Optional integrations (blank = clean no-op)
TURNSTILE_SECRET=${TURNSTILE_SECRET:-}
SENTRY_DSN=${SENTRY_DSN:-}
# Web public envs (baked into the web + admin builds at build time)
NEXT_PUBLIC_API_URL=https://api.ruletka.top/api
NEXT_PUBLIC_WS_URL=https://api.ruletka.top
NEXT_PUBLIC_STUN_URLS=stun:turn.ruletka.top:3478
NEXT_PUBLIC_TURN_URLS=turn:turn.ruletka.top:3478,turns:turn.ruletka.top:5349
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${VAPID_PUB}
NEXT_PUBLIC_TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY:-}
NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN:-${SENTRY_DSN:-}}
NEXT_PUBLIC_ANALYTICS_DOMAIN=${ANALYTICS_DOMAIN:-}
NEXT_PUBLIC_ANALYTICS_HOST=${ANALYTICS_HOST:-}
# CDN asset prefix — empty = same-origin (today's behavior). Set ASSET_PREFIX
# (e.g. https://cdn.ruletka.top) before bootstrap, or edit .env, to serve
# /_next/static + build assets from the CDN, then rebuild the web image.
NEXT_PUBLIC_ASSET_PREFIX=${ASSET_PREFIX:-}
VITE_API_URL=https://api.ruletka.top/api
EOF
  chmod 600 .env
  echo ".env written (chmod 600)."
else
  say ".env already present — reusing it."
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

# nginx.conf is a SINGLE-FILE bind-mount: `up -d` does NOT pick up content changes
# (the container keeps the old inode), so a config edit silently never applies.
# Force-recreate nginx ONLY when the file changed since the last deploy — avoids a
# needless ~1s :443 blip on deploys that don't touch nginx.
NGINX_HASH="$(sha256sum infra/nginx/nginx.conf 2>/dev/null | cut -d' ' -f1)"
if [ -n "$NGINX_HASH" ] && [ "$NGINX_HASH" != "$(cat .nginx.conf.hash 2>/dev/null || true)" ]; then
  say "nginx.conf changed → recreating nginx so the new config takes effect…"
  $COMPOSE up -d --no-deps --force-recreate nginx
  printf '%s\n' "$NGINX_HASH" > .nginx.conf.hash
else
  # Even when nginx.conf is unchanged, `up -d --build` above may have RECREATED the
  # api/web containers (new code → new image → new container → NEW Docker network IP).
  # Our upstreams (`server api:4000;` / `server web:3000;`) resolve the hostname ONCE
  # at nginx startup and cache the IP — there is no `resolver` directive — so nginx
  # keeps proxying to the DEAD old IP → intermittent 502 Bad Gateway until something
  # reloads it. A graceful reload re-resolves the upstream hostnames with zero downtime,
  # so every deploy self-heals the api/web upstream IPs. (Root cause of "site dies after
  # a deploy": the old code only refreshed nginx on a config-hash change, never on a
  # plain code deploy that moved the api container.)
  say "Reloading nginx so it re-resolves api/web upstream IPs (containers may have moved)…"
  docker exec ruletka-nginx nginx -s reload 2>/dev/null \
    || $COMPOSE up -d --no-deps --force-recreate nginx
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
  $COMPOSE exec -T mongo1 mongosh ruletka --quiet --eval \
    "print(db.users.updateOne({email:'${ADMIN_EMAIL}'},{\$set:{role:'admin'}}).matchedCount ? 'role=admin set for ${ADMIN_EMAIL}' : 'no user ${ADMIN_EMAIL} (register first, then re-run)');" \
    || warn "Could not set admin role (is the user registered?)."
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
