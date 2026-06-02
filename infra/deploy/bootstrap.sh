#!/usr/bin/env bash
# =============================================================================
# bootstrap.sh — one-command production deploy for ruletka.top
# -----------------------------------------------------------------------------
# Target: a fresh Debian/Ubuntu VPS (e.g. Timeweb 186.246.9.90) where DNS for
# ruletka.top / www / api / admin / turn already points at this host, and mail
# is handled externally (Timeweb MX — nothing mail-related runs here).
#
# Run AS ROOT, from the repo root, on the server:
#     bash infra/deploy/bootstrap.sh
#
# Idempotent: re-running skips Docker install, reuses existing certs/secrets,
# and just rebuilds + restarts. Secrets are generated once into ./.env (which is
# gitignored) — the SMTP password is PROMPTED (never stored in the repo).
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
COMPOSE="docker compose -f infra/docker/docker-compose.prod.yml"
DOMAINS=(ruletka.top www.ruletka.top api.ruletka.top admin.ruletka.top turn.ruletka.top)
ACME_EMAIL="admin@ruletka.top"

say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ── 1. Docker ────────────────────────────────────────────────────────────────
if ! have docker; then
  say "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "docker compose plugin missing"; exit 1; }

# ── 2. Free :80/:443 check (nginx needs them; mail ports are NOT used here) ──
if ss -tlnp 2>/dev/null | grep -E ':(80|443) ' | grep -vq 'docker\|nginx'; then
  say "WARNING: something already listens on :80/:443 — free it or this nginx won't bind. Continuing in 5s…"
  ss -tlnp | grep -E ':(80|443) ' || true
  sleep 5
fi

# ── 3. Secrets / .env (generated once) ──────────────────────────────────────
if [ ! -f .env ]; then
  say "Generating .env (one-time)…"
  read -rsp "SMTP password for no-reply@ruletka.top (smtp.timeweb.ru): " SMTP_PASS; echo
  : "${SMTP_PASS:?SMTP password required}"
  # Optional integrations — leave blank to keep them as no-ops.
  read -rp "Cloudflare Turnstile SITE key (blank = CAPTCHA off): " TS_SITE || true
  read -rp "Cloudflare Turnstile SECRET (blank = CAPTCHA off): " TS_SECRET || true
  read -rp "Sentry DSN (blank = error tracking off): " SENTRY || true
  VAPID_JSON="$(npx --yes web-push generate-vapid-keys --json 2>/dev/null || echo '{}')"
  VAPID_PUB="$(printf '%s' "$VAPID_JSON" | sed -n 's/.*"publicKey":"\([^"]*\)".*/\1/p')"
  VAPID_PRIV="$(printf '%s' "$VAPID_JSON" | sed -n 's/.*"privateKey":"\([^"]*\)".*/\1/p')"
  cat > .env <<EOF
NODE_ENV=production
API_PORT=4000
API_HOST=0.0.0.0
API_GLOBAL_PREFIX=api
CORS_ORIGINS=https://ruletka.top,https://www.ruletka.top,https://admin.ruletka.top
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
# Email — Timeweb SMTP (465 = implicit TLS)
SMTP_HOST=smtp.timeweb.ru
SMTP_PORT=465
SMTP_USER=no-reply@ruletka.top
SMTP_PASS=${SMTP_PASS}
MAIL_FROM=Рулетка <no-reply@ruletka.top>
WEB_BASE_URL=https://ruletka.top
# Web Push (auto-generated)
VAPID_PUBLIC_KEY=${VAPID_PUB}
VAPID_PRIVATE_KEY=${VAPID_PRIV}
VAPID_SUBJECT=mailto:admin@ruletka.top
# CAPTCHA / Sentry (optional)
TURNSTILE_SECRET=${TS_SECRET}
SENTRY_DSN=${SENTRY}
# Web public envs (baked into the web + admin builds)
NEXT_PUBLIC_API_URL=https://api.ruletka.top/api
NEXT_PUBLIC_WS_URL=https://api.ruletka.top
NEXT_PUBLIC_STUN_URLS=stun:turn.ruletka.top:3478
NEXT_PUBLIC_TURN_URLS=turn:turn.ruletka.top:3478,turns:turn.ruletka.top:5349
NEXT_PUBLIC_VAPID_PUBLIC_KEY=${VAPID_PUB}
NEXT_PUBLIC_TURNSTILE_SITE_KEY=${TS_SITE}
NEXT_PUBLIC_SENTRY_DSN=${SENTRY}
VITE_API_URL=https://api.ruletka.top/api
EOF
  chmod 600 .env
  echo ".env written (chmod 600)."
fi
set -a; . ./.env; set +a

# ── 4. Build the admin SPA (nginx serves its static dist) ────────────────────
say "Building shared-types + admin SPA…"
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile
pnpm --filter @ruletka/shared-types build
VITE_API_URL="$NEXT_PUBLIC_API_URL" pnpm --filter @ruletka/admin build

# ── 5. TLS certificate (one cert, all subdomains) — issue if absent ─────────
if ! docker run --rm -v ruletka-letsencrypt:/etc/letsencrypt alpine \
      test -d /etc/letsencrypt/live/ruletka.top 2>/dev/null; then
  say "Issuing Let's Encrypt cert (standalone; needs :80 free for ~30s)…"
  CERT_ARGS=(); for d in "${DOMAINS[@]}"; do CERT_ARGS+=(-d "$d"); done
  docker run --rm -p 80:80 \
    -v ruletka-letsencrypt:/etc/letsencrypt -v ruletka-certbot-webroot:/var/www/certbot \
    certbot/certbot certonly --standalone --non-interactive --agree-tos -m "$ACME_EMAIL" \
    "${CERT_ARGS[@]}"
fi

# ── 6. Bring up the stack ────────────────────────────────────────────────────
say "Building + starting the stack…"
$COMPOSE up -d --build
say "Waiting for the API to become healthy…"
for i in $(seq 1 30); do
  if curl -fsS https://api.ruletka.top/api/health >/dev/null 2>&1; then echo "API healthy."; break; fi
  sleep 5
done

# ── 7. Seed an admin user ────────────────────────────────────────────────────
say "Promote a user to admin (for admin.ruletka.top). Leave blank to skip."
read -rp "Admin email (must already be registered): " ADMIN_EMAIL || true
if [ -n "${ADMIN_EMAIL:-}" ]; then
  $COMPOSE exec -T mongo1 mongosh ruletka --quiet --eval \
    "db.users.updateOne({email:'${ADMIN_EMAIL}'},{\$set:{role:'admin'}}); print('role set for ${ADMIN_EMAIL}');" || \
    echo "Could not set role (register the email first, then re-run this step)."
fi

say "Done. Verify:"
echo "  curl -I https://ruletka.top ; curl -s https://api.ruletka.top/api/health ; curl -I https://admin.ruletka.top"
echo "  (coturn TLS: see DEPLOY.md §4 to point turnserver.conf at the issued cert.)"
