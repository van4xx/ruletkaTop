# ruletka.top — Operator Secrets Install Runbook

> **What this is.** The single source of truth for installing every
> operator-supplied secret on the production server **after** the initial
> `bootstrap.sh` has run. Every snippet is the **exact shell** you copy-paste
> over SSH against the live box (`/opt/ruletka`, ubuntu/debian, docker
> compose).
>
> **What it is not.** This is not a re-derivation of the architecture —
> `infra/deploy/ENV_CHECKLIST.md` and `LAUNCH-CHECKLIST.md` cover that. Use
> those to understand **why** a value is needed; come here to **install** it.
>
> **NEVER paste real secrets into a committed file.** Every value below uses a
> `<PASTE_…_HERE>` placeholder. Keep secrets in your password manager / vault;
> only the live `/opt/ruletka/.env` should ever hold the real values, and that
> file is `chmod 600`, git-ignored, and never logged.

---

## TL;DR — what the operator must supply

| Secret group | Required for launch? | Generated for you? | Apply method |
|---|---|---|---|
| **Cloudflare Turnstile** (`TURNSTILE_SECRET` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) | **YES** — API fails-fast at boot without the secret; widget hides without the site key → registration closed. | No — operator pulls from Cloudflare. | §1 below. `bootstrap.sh` REQUIRES both; this section covers re-install / rotate. |
| **T-Bank** (payments — `TBANK_*`) | YES (before opening paid flows) | No | §2 below. Restart API; no rebuild. |
| **Sightengine** (server NSFW scorer — `SIGHTENGINE_API_USER` + `MODERATION_PROVIDER_API_KEY`) | Recommended | No | §3 below. Restart API. |
| **`METRICS_TOKEN`** (Prometheus bearer) | YES (prod fails-fast) | **YES — `bootstrap.sh` auto-generates** | §4. Nothing to do — operator never touches it. |
| **Mongo auth** (keyFile + root/app passwords) | YES | **YES — `bootstrap.sh` auto-generates on first deploy** | §5. Nothing to do unless rotating. |
| **Firebase** (mobile push) | **NO — deferred** | n/a | §6. Skip until after launch. |
| **NSFW TFLite model** (mobile on-device) | **NO — deferred** | n/a | §7. Drop the binary if/when shipped to mobile users. |
| After-deploy index sync (`RUN_INDEX_SYNC=true`) | YES — on the **first** deploy only | n/a | §8. |

> **POST-LAUNCH ROTATE (read this before anything else).** Two of the secrets
> below — **`TURNSTILE_SECRET`** and **`TBANK_PASSWORD`** — almost always reach
> the operator over channels that aren't audit-clean (chat, e-mail, paste
> buffer). **Rotate both within the first few days post-launch:** issue a fresh
> Cloudflare Turnstile widget and re-generate the T-Bank API password, then
> re-run the steps in §1 / §2 with the new values. Old values are then
> revoked at the provider; even if the originals were captured in transit
> they're now worthless.

---

## How edits to `/opt/ruletka/.env` apply

Same pattern as `ENV_CHECKLIST.md`:

```bash
cd /opt/ruletka
sed -i '/^KEY=/d' .env && echo 'KEY=value' >> .env
```

Then apply:

- **API-only var** → restart api: `docker compose --env-file .env -f infra/docker/docker-compose.prod.yml up -d --no-deps api`
- **`NEXT_PUBLIC_*` (web build) var** → **rebuild** the web image (it bakes at
  build-time): `docker compose --env-file .env -f infra/docker/docker-compose.prod.yml up -d --no-deps --build web` (or re-run `bash infra/deploy/bootstrap.sh`, which rebuilds web with the current `.env`).

Every section below names which restart/rebuild to run.

---

## 1. Cloudflare Turnstile (anti-bot — REQUIRED for launch)

**Where to get the keys.** Cloudflare dashboard → **Turnstile** → **Add widget**
→ create one widget per environment (one for prod, optionally one for staging).
The widget page shows two values:

- **Site key** (public, safe to expose) → goes into `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (web build-time).
- **Secret key** (server-only, treat like a JWT secret) → goes into `TURNSTILE_SECRET` (API runtime).

Set the widget's **Hostname management** to `ruletka.top` (and any other
hostnames you serve the register form from). Mode = **Managed** (default).

**Behaviour reminder.** The API's `CaptchaService` (`apps/api/src/modules/auth/captcha.service.ts`)
POSTs `secret`+`response` to `https://challenges.cloudflare.com/turnstile/v0/siteverify`,
returns the boolean `success`, and **fails closed** on any network/HTTP error so
a Cloudflare outage cannot be used to bypass the gate. The web widget
(`apps/web/src/components/auth/turnstile-widget.tsx`) reads
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` at build time and is rendered unconditionally
on `/register`; with the key set, the register form blocks submit until a token
is solved (`captchaRequired = Boolean(TURNSTILE_SITE_KEY)`).

`bootstrap.sh` ALREADY requires both keys (it prompts on a TTY, else aborts —
see §3 of the script). This section is for **re-installing / rotating** them on
an already-deployed server.

```bash
cd /opt/ruletka

# 1) Set the two Turnstile values (idempotent: delete-then-append).
TURNSTILE_SECRET='<PASTE_TURNSTILE_SECRET_HERE>'        # Cloudflare → Turnstile → your widget → Secret key (server-only)
TURNSTILE_SITE_KEY='<PASTE_TURNSTILE_SITE_KEY_HERE>'    # Cloudflare → Turnstile → your widget → Site key (public)

# API runtime (secret only):
sed -i '/^TURNSTILE_SECRET=/d' .env \
  && echo "TURNSTILE_SECRET=${TURNSTILE_SECRET}" >> .env

# Web BUILD-time (the docker-compose web service reads this as a build-arg):
sed -i '/^NEXT_PUBLIC_TURNSTILE_SITE_KEY=/d' .env \
  && echo "NEXT_PUBLIC_TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY}" >> .env

# 2) Apply.
COMPOSE="docker compose --env-file .env -f infra/docker/docker-compose.prod.yml"

# API: restart picks up the new secret immediately.
$COMPOSE up -d --no-deps api

# Web: must REBUILD so NEXT_PUBLIC_TURNSTILE_SITE_KEY is baked into the bundle.
$COMPOSE up -d --no-deps --build web
# …or simply re-run the whole bootstrap, which rebuilds web with the new .env:
#   bash infra/deploy/bootstrap.sh
```

**Smoke test.**
- `curl -fsS https://api.ruletka.top/api/health` returns `ok` (boot didn't fail-fast).
- Open `https://ruletka.top/register` in a private window — the Turnstile widget
  renders; submit is blocked until you solve it. Submitting with no token /
  a stale token surfaces the API's "CAPTCHA verification failed" rejection
  (400 BadRequest from `auth.service.ts`).

**Rotate.** Issue a new widget in Cloudflare (don't reuse the old keys), repeat
the steps above with the new values. The old secret is auto-revoked the moment
the new widget is saved. Do this within the first week post-launch.

---

## 2. T-Bank (payments — REQUIRED before opening paid flows)

> **NOTE on integration state.** The T-Bank payments integration lands as a
> follow-up after the initial launch; this section pre-stages the env shape so
> the operator can drop the values in the moment the code lands and the only
> remaining step is a restart. Wire the dashboard webhooks to the API URLs
> shown below the table.

| Var | What it is | Where to get it |
|---|---|---|
| `TBANK_TERMINAL_KEY` | Merchant terminal id (account-public). The DEMO terminal id ends with `DEMO` → keep test mode on while wired against it. | T-Bank merchant dashboard → Terminal → Terminal Key |
| `TBANK_PASSWORD` | Server-secret used to compute the `Token` HMAC on every request and to verify webhook signatures. **Rotate post-launch.** | T-Bank merchant dashboard → Terminal → Password |
| `TBANK_IS_TEST` | `true` while wired against the DEMO terminal; **set to `false` on go-live** (else real cards are silently rejected by the demo gateway). | literal |
| `TBANK_WEBHOOK_IPS` | Comma-separated source IP allow-list for inbound notifications (defence in depth on top of the HMAC). | T-Bank docs → published notification IPs |
| `TBANK_SUCCESS_URL` | Return URL on a successful charge (web route). | derive from your domain |
| `TBANK_FAIL_URL` | Return URL on a failed/cancelled charge. | derive from your domain |

```bash
cd /opt/ruletka

# 1) Set the six T-Bank values.
TBANK_TERMINAL_KEY='<PASTE_TBANK_TERMINAL_KEY_HERE>'        # ends with DEMO while testing → flip TBANK_IS_TEST accordingly
TBANK_PASSWORD='<PASTE_TBANK_PASSWORD_HERE>'                # rotate post-launch
TBANK_IS_TEST='true'                                        # ⚠️ flip to 'false' on go-live
TBANK_WEBHOOK_IPS='<PASTE_TBANK_WEBHOOK_IPS_HERE>'          # e.g. '91.218.132.0/24,91.194.226.0/24' — T-Bank's published ranges
TBANK_SUCCESS_URL='https://ruletka.top/payment/success'
TBANK_FAIL_URL='https://ruletka.top/payment/fail'

for KV in \
  "TBANK_TERMINAL_KEY=${TBANK_TERMINAL_KEY}" \
  "TBANK_PASSWORD=${TBANK_PASSWORD}" \
  "TBANK_IS_TEST=${TBANK_IS_TEST}" \
  "TBANK_WEBHOOK_IPS=${TBANK_WEBHOOK_IPS}" \
  "TBANK_SUCCESS_URL=${TBANK_SUCCESS_URL}" \
  "TBANK_FAIL_URL=${TBANK_FAIL_URL}"; do
  K="${KV%%=*}"
  sed -i "/^${K}=/d" .env && echo "${KV}" >> .env
done

# 2) Apply — API restart only (no NEXT_PUBLIC_* here):
docker compose --env-file .env -f infra/docker/docker-compose.prod.yml up -d --no-deps api
```

**Then in the T-Bank dashboard:** point the **notification** webhook(s) at the
API route the payments module exposes (e.g.
`https://api.ruletka.top/api/payments/tbank/webhook` — confirm against the
controller once the module ships). The webhook handler verifies the `Token`
HMAC using `TBANK_PASSWORD` and additionally checks the source IP against
`TBANK_WEBHOOK_IPS`; either check failing → 401 → no fulfilment.

**Smoke test.** With `TBANK_IS_TEST=true`, run a small charge against the demo
terminal end-to-end (web → T-Bank widget → success URL → wallet credit). Flip
`TBANK_IS_TEST=false` ONLY after a real-card test has passed in your sandbox
and the terminal id no longer ends with `DEMO`.

**Rotate `TBANK_PASSWORD`** in the T-Bank dashboard within the first week
post-launch, then re-run the snippet above with the new value + API restart.

---

## 3. Sightengine (server-side NSFW frame scorer)

`FRAME_SCORER` defaults to `noop` (the API trusts the on-device classifier
report). Switching it to `provider` turns on the Sightengine-backed
second-opinion scorer for moderation reports. The integration is **fail-open**:
on a provider outage the scorer returns `safe/0` rather than blocking calls.

Credentials usually arrive **already supplied by the operator** — they live in
your secrets vault.

```bash
cd /opt/ruletka

# Activate the provider scorer + install the credentials.
SIGHTENGINE_API_USER='<PASTE_SIGHTENGINE_API_USER_HERE>'
MODERATION_PROVIDER_API_KEY='<PASTE_SIGHTENGINE_API_SECRET_HERE>'    # Sightengine's "api_secret" field

for KV in \
  "FRAME_SCORER=provider" \
  "SIGHTENGINE_API_USER=${SIGHTENGINE_API_USER}" \
  "MODERATION_PROVIDER_API_KEY=${MODERATION_PROVIDER_API_KEY}"; do
  K="${KV%%=*}"
  sed -i "/^${K}=/d" .env && echo "${KV}" >> .env
done

# Optional tunables (sensible defaults baked in — leave unset unless tuning):
# sed -i '/^SIGHTENGINE_MODELS=/d'   .env && echo 'SIGHTENGINE_MODELS=nudity-2.1,gore-2.0' >> .env
# sed -i '/^SIGHTENGINE_MIN_PROB=/d' .env && echo 'SIGHTENGINE_MIN_PROB=0.5'                >> .env

# API restart picks it up — no rebuild needed.
docker compose --env-file .env -f infra/docker/docker-compose.prod.yml up -d --no-deps api
```

**Smoke test.** Trigger a moderation report from a test session; check
`docker compose … logs api | grep -i sightengine` shows a real HTTP call (not a
no-op) and the moderation record carries the provider's verdict.

---

## 4. `METRICS_TOKEN` (Prometheus scrape bearer)

**Nothing to do.** `bootstrap.sh` auto-generates this with `openssl rand -hex 32`
on first deploy and writes it to `.env`; the API's `MetricsTokenGuard`
fails-fast at boot in prod if it's blank, so a fresh deploy cannot ship
`/api/metrics` open to the public edge. To read it back:

```bash
grep -E '^METRICS_TOKEN=' /opt/ruletka/.env | cut -d= -f2-
```

Pass that value as `Authorization: Bearer …` from your Prometheus scrape config.
To rotate, generate a new one, replace via `sed -i`, restart api, and update
the Prometheus config in lockstep.

---

## 5. Mongo authentication

**Nothing to do** on a fresh first deploy. `bootstrap.sh` generates **all four
secrets** automatically (you never see/handle them):

- `infra/secrets/mongo-keyfile` — `openssl rand -base64 756`, chmod 400 (the
  replica-set internal keyFile bind-mounted into all three nodes).
- `MONGO_ROOT_USERNAME=root` + `MONGO_ROOT_PASSWORD=<openssl rand -hex 24>`.
- `MONGO_APP_USERNAME=app` + `MONGO_APP_PASSWORD=<openssl rand -hex 24>` (the
  least-privilege user the API connects as).

The credentialed `MONGODB_URI` in `.env` is built from these and is the single
source of truth (compose reads it via `${MONGODB_URI:?…}`).

> ⚠️ The keyFile is part of each node's on-disk identity. Do NOT regenerate it
> against existing `mongoN-data` volumes — follow MongoDB's keyFile-rotation
> rolling-restart runbook instead. Rotating the **app password** is safe and
> straightforward (see `ENV_CHECKLIST.md` → MongoDB section).

---

## 6. Firebase (mobile push) — DEFERRED

**Skip for launch.** Mobile push notifications are deferred until after the
initial release. Until then `FIREBASE_SERVICE_ACCOUNT` stays blank → the API's
mobile-push provider is a clean no-op (in-app + socket delivery continue to
work; only native push fan-out is skipped). When you do enable it:

```bash
# Paste the Firebase service-account JSON as a single line (raw or base64).
# Get it from: Firebase console → Project settings → Service accounts →
# "Generate new private key" → download the .json.
cd /opt/ruletka

# Encoding the JSON as base64 avoids any quoting issues in .env:
FIREBASE_SERVICE_ACCOUNT="$(base64 -w0 < /path/to/firebase-service-account.json)"

sed -i '/^FIREBASE_SERVICE_ACCOUNT=/d' .env \
  && echo "FIREBASE_SERVICE_ACCOUNT=${FIREBASE_SERVICE_ACCOUNT}" >> .env

docker compose --env-file .env -f infra/docker/docker-compose.prod.yml up -d --no-deps api
```

Plus the **mobile-side config files** (NOT installed on the server — they ride
the mobile build): `apps/mobile/android/app/google-services.json` and
`apps/mobile/ios/Runner/GoogleService-Info.plist`. Both live in
`LAUNCH-CHECKLIST.md` §1 under "Mobile Firebase config files".

---

## 7. NSFW TFLite model (mobile on-device) — DEFERRED

**Skip for launch.** The mobile on-device NSFW classifier is deferred. When
shipping it to mobile users, drop the binary at
`apps/mobile/assets/models/nsfw.tflite` (gantman/nsfw_model MobileNetV2 — see
`apps/mobile/assets/models/README.md` for the exact spec) and rebuild the
mobile app. There is **no server-side step** — the server-side Sightengine
second-opinion scorer (§3) applies regardless of whether the on-device model
is shipped.

---

## 8. First-deploy index sync (one-shot)

Production runs with Mongoose `autoIndex` OFF. On the **very first deploy** (or
after any of the index changes called out in `LAUNCH-CHECKLIST.md` §3) boot
the API once with `RUN_INDEX_SYNC=true` so missing indexes are reconciled
explicitly. The boot LOUDLY aborts on any duplicate-data conflict — resolve
duplicates first (the dedup queries are in `LAUNCH-CHECKLIST.md` §3).

```bash
cd /opt/ruletka
COMPOSE="docker compose --env-file .env -f infra/docker/docker-compose.prod.yml"

# 1) Enable.
sed -i '/^RUN_INDEX_SYNC=/d' .env && echo 'RUN_INDEX_SYNC=true' >> .env

# 2) Restart the API and watch the logs for "Mongo index sync complete."
$COMPOSE up -d --no-deps api
$COMPOSE logs -f --tail=100 api

# 3) Disable for normal boots (otherwise every restart re-runs the sync work).
sed -i '/^RUN_INDEX_SYNC=/d' .env && echo 'RUN_INDEX_SYNC=false' >> .env
$COMPOSE up -d --no-deps api
```

---

## Final checklist before opening to users

- [ ] §1 Turnstile — both keys installed, register flow blocked-then-solved in a private window.
- [ ] §2 T-Bank — keys installed, `TBANK_IS_TEST=false` AFTER a real-card test, webhook configured in T-Bank dash.
- [ ] §3 Sightengine — credentials installed, `FRAME_SCORER=provider`, a test report shows a real provider call in API logs.
- [ ] §4 `METRICS_TOKEN` — Prometheus scrape returns 200 with the bearer; without it returns 401.
- [ ] §5 Mongo auth — `$COMPOSE exec -T mongo1 mongosh ruletka --quiet -u <root> -p <root pw> --authenticationDatabase admin --eval 'db.getUsers()'` returns both `root` and `app` users.
- [ ] §8 Index sync — boot log shows "Mongo index sync complete.", then `RUN_INDEX_SYNC=false` set.
- [ ] **ROTATE** `TURNSTILE_SECRET` + `TBANK_PASSWORD` within the first week post-launch (provider dash → re-issue → re-run §1 / §2).
- [ ] Back up `/opt/ruletka/.env` (chmod 600) and `infra/secrets/mongo-keyfile` (chmod 400) to your password manager / vault. **Do NOT commit them.**

— End of runbook.
