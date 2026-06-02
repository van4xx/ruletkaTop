# Deploy ruletka.top — 3 subdomains on one server (186.246.9.90)

Production topology (DNS already points all of these at `186.246.9.90`, A + AAAA):

| Host                             | Serves                  | Container                           |
| -------------------------------- | ----------------------- | ----------------------------------- |
| `ruletka.top`, `www.ruletka.top` | Web (Next.js)           | `web`                               |
| `api.ruletka.top`                | REST `/api` + Socket.io | `api` (×2 replicas)                 |
| `admin.ruletka.top`              | Admin SPA (static)      | served by `nginx` from `/srv/admin` |
| `turn.ruletka.top`               | TURN relay (3478/5349)  | `coturn`                            |

**Mail is external (Timeweb MX `mx1/mx2.timeweb.ru`)** — nothing mail-related runs on
this box, so there's no Postfix/Dovecot to preserve and ports 25/465/587/993 are
irrelevant here. nginx owns **:80/:443**; coturn owns **3478/5349 (+49160-49200/udp)**.

---

## 0. One-command deploy (recommended)

The box is a fresh Timeweb VPS, so the whole bring-up is scripted. SSH in **from your
own machine** (the server firewall only admits your IP), clone, and run one script:

```sh
ssh root@186.246.9.90
git clone <your-repo-url> /opt/ruletka && cd /opt/ruletka
bash infra/deploy/bootstrap.sh
```

`bootstrap.sh` is idempotent and does everything below: installs Docker, **prompts
once for the SMTP password** (and optional Turnstile/Sentry keys), generates all
other secrets into a `chmod 600 .env`, builds `@ruletka/shared-types` + the admin
SPA, issues the Let's Encrypt cert for all five names, `docker compose up -d --build`,
waits for API health, and offers to promote an admin user. Re-running it reuses the
existing `.env` + cert and just rebuilds. The manual steps below are the reference
for when you want to do it by hand or debug a step.

> **Why a script and not "Claude does it"?** Your server's firewall drops connections
> from anywhere but your IP (I confirmed `ssh root@186.246.9.90` times out at the TCP
> layer from my sandbox while `ssh git@github.com` succeeds). So deployment runs from
> **your** SSH session, not mine.

---

## 1. One-time server prep

```sh
# Docker + compose plugin (Debian/Ubuntu)
curl -fsSL https://get.docker.com | sh
docker compose version            # confirm v2

# Confirm nothing else holds 80/443 (a fresh box is clean):
ss -tlnp | grep -E ':(80|443) ' || echo "80/443 free ✓"

git clone <your-repo-url> /opt/ruletka && cd /opt/ruletka
```

## 2. Secrets — generate strong ones (never commit `.env`)

```sh
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 48)"
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 48)"
echo "TURN_STATIC_AUTH_SECRET=$(openssl rand -hex 32)"
echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
npx web-push generate-vapid-keys        # → VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (+ NEXT_PUBLIC_VAPID_PUBLIC_KEY = the public one)
```

### Production `.env` values (the ones that differ from dev)

```ini
NODE_ENV=production
# Real-transaction multi-node RS (the prod compose runs mongo1/2/3):
MONGODB_URI=mongodb://mongo1:27017,mongo2:27017,mongo3:27017/ruletka?replicaSet=rs0&retryWrites=true&w=majority
REDIS_PASSWORD=<generated>
# CORS: the web + admin origins (credentialed). NO trailing slash.
CORS_ORIGINS=https://ruletka.top,https://www.ruletka.top,https://admin.ruletka.top
# TURN
TURN_HOST=turn.ruletka.top
TURN_REALM=ruletka.top
TURN_STATIC_AUTH_SECRET=<generated>
# Web (baked at build time)
NEXT_PUBLIC_API_URL=https://api.ruletka.top/api
NEXT_PUBLIC_WS_URL=https://api.ruletka.top
NEXT_PUBLIC_STUN_URLS=stun:turn.ruletka.top:3478
NEXT_PUBLIC_TURN_URLS=turn:turn.ruletka.top:3478,turns:turn.ruletka.top:5349
# Admin SPA build (apps/admin reads VITE_API_URL at build):
VITE_API_URL=https://api.ruletka.top/api
# Email — Timeweb SMTP. Port 465 ⇒ implicit TLS (the Mailer enables `secure` on 465).
SMTP_HOST=smtp.timeweb.ru
SMTP_PORT=465
SMTP_USER=no-reply@ruletka.top
SMTP_PASS=<the Timeweb mailbox password>
MAIL_FROM="Рулетка <no-reply@ruletka.top>"
# Optional but recommended: SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN, TURNSTILE_SECRET +
# NEXT_PUBLIC_TURNSTILE_SITE_KEY, FRAME_SCORER=provider + MODERATION_PROVIDER_API_KEY.
```

## 3. Build the admin SPA (nginx serves its static `dist/`)

```sh
corepack enable && pnpm install --frozen-lockfile
pnpm --filter @ruletka/shared-types build
VITE_API_URL=https://api.ruletka.top/api pnpm --filter @ruletka/admin build   # → apps/admin/dist
```

## 4. Issue TLS certs (one cert, all subdomains incl. turn)

nginx's :443 blocks need the cert before they start, so issue **standalone** first
(needs :80 free for ~30s):

```sh
docker run --rm -p 80:80 \
  -v ruletka-letsencrypt:/etc/letsencrypt \
  -v ruletka-certbot-webroot:/var/www/certbot \
  certbot/certbot certonly --standalone --non-interactive --agree-tos \
  -m admin@ruletka.top \
  -d ruletka.top -d www.ruletka.top -d api.ruletka.top -d admin.ruletka.top -d turn.ruletka.top
```

(After this, the `certbot` service in the compose auto-renews every 12h.)

### coturn TLS (turns:5349)

Point coturn at the same cert — add to `infra/coturn/turnserver.conf`:

```
cert=/etc/letsencrypt/live/ruletka.top/fullchain.pem
pkey=/etc/letsencrypt/live/ruletka.top/privkey.pem
```

and mount `letsencrypt:/etc/letsencrypt:ro` on the `coturn` service.

## 5. Bring up the stack

```sh
docker compose -f infra/docker/docker-compose.prod.yml up -d --build
docker compose -f infra/docker/docker-compose.prod.yml ps      # all healthy?
docker compose -f infra/docker/docker-compose.prod.yml logs -f mongo-init   # rs0 initiated once
```

## 6. Seed an admin/moderator account

The admin panel (`admin.ruletka.top`) only lets `admin`/`moderator` roles in.
Register the email through the normal sign-up first, then promote it once:

```sh
docker compose -f infra/docker/docker-compose.prod.yml exec mongo1 \
  mongosh ruletka --eval 'db.users.updateOne({email:"you@ruletka.top"},{$set:{role:"admin"}})'
```

## 7. Verify

```sh
curl -I https://ruletka.top                       # 200, web
curl -s https://api.ruletka.top/api/health        # {"status":"ok",...}
curl -I https://admin.ruletka.top                 # 200, admin SPA
# Email: trigger a password reset and confirm the message arrives from no-reply@ruletka.top.
# WebRTC: open https://ruletka.top on two devices/networks → video should connect via TURN.
```

## Updates / rollback

```sh
git pull
pnpm --filter @ruletka/shared-types build && pnpm --filter @ruletka/admin build
docker compose -f infra/docker/docker-compose.prod.yml up -d --build
# rollback: `git checkout <prev>` + the same up --build.
```

See `PRODUCTION.md` for the security/ops checklist (secrets rotation, Mongo
auth/TLS hardening, TURN scaling, observability).
