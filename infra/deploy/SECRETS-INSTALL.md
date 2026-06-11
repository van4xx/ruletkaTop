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
| **`METRICS_TOKEN`** (Prometheus bearer) | YES (prod fails-fast) | **YES — `bootstrap.sh` auto-generates AND self-heals** | §4. Nothing to do — operator never touches it. Missing on an older `.env`? Next bootstrap run upserts it automatically. |
| **Mongo auth** (keyFile + root/app passwords) | YES | **YES — `bootstrap.sh` auto-generates on first deploy AND self-heals on every subsequent run** | §5. Nothing to do unless rotating. If any of `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` / `MONGO_APP_USERNAME` / `MONGO_APP_PASSWORD` were missing from a pre-existing `.env`, bootstrap upserts defaults+fresh passwords; if the on-disk Mongo nodes already came up `--auth --keyFile` with no users (lost the root creation race), bootstrap also runs a one-shot **localhost-exception** user-bootstrap on `mongo1` to create root + app — the same recovery we used to run by hand. |
| **Firebase** (mobile push) | **NO — deferred** | n/a | §6. Skip until after launch. |
| **NSFW TFLite model** (mobile on-device) | **NO — deferred** | n/a | §7. Drop the binary if/when shipped to mobile users. |
| After-deploy index sync (`RUN_INDEX_SYNC=true`) | YES — on the **first** deploy only | n/a | §8. |
| **Telegram alert bot** (`TELEGRAM_ALERT_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID`) | Recommended — without it the cert-watch sidecar can only emit the Prometheus gauge (no Telegram on-call ping) | No — operator pulls from BotFather | §9 below. Used by the **cert-watch** HTTPS-cert expiry monitor; the `ruletka_cert_expiry_days{domain}` gauge keeps working with both blank, so Alertmanager paging is unaffected — Telegram is the secondary signal. |

> **POST-LAUNCH ROTATE (read this before anything else).** Two of the secrets
> below — **`TURNSTILE_SECRET`** and **`TBANK_PASSWORD`** — almost always reach
> the operator over channels that aren't audit-clean (chat, e-mail, paste
> buffer). **Rotate both within the first few days post-launch:** issue a fresh
> Cloudflare Turnstile widget and re-generate the T-Bank API password, then
> re-run the steps in §1 / §2 with the new values. Old values are then
> revoked at the provider; even if the originals were captured in transit
> they're now worthless.

---

## Deferred features (post-monetization)

> **Read this first if you cloned the repo and saw blank env vars.** Three
> features ship with all the code wired but are **intentionally OFF by default**
> until the platform starts earning. Each one is either paid (S3, KYC) or
> requires an operator-supplied binary asset (mobile NSFW model). Leaving them
> off is the supported launch-day configuration — the stack boots clean with
> none of them enabled. Flip them on individually once revenue covers the cost
> (or, for the mobile model, when the mobile app has a real install base).

### 1. S3 Mongo backup (nightly bucket upload)

- **WHAT.** The `backup` sidecar in `infra/docker/docker-compose.prod.yml`
  runs `mongodump` of the whole `ruletka` db + tar of the replica-set keyFile
  at 03:30 UTC daily and uploads to S3, with 30-day retention. Without it
  a server hardware failure loses everything since the last manual snapshot.
- **WHEN to revisit.** As soon as you have paying users or any DB content
  worth restoring. Bucket cost on Timeweb-S3 is **~100–200 ₽/мес** (~€1–2).
- **HOW to enable.** The sidecar is gated behind a Compose profile — the
  default `docker compose up -d` does NOT start it, so a blank `.env`
  is harmless. To turn it on:
  1. Fill the five `S3_BACKUP_*` vars + `BACKUP_RETENTION_DAYS` in
     `/opt/ruletka/.env` (see §9 below for the exact snippet + bucket setup).
  2. `docker compose -f infra/docker/docker-compose.prod.yml --profile backup up -d`
  3. Smoke-test with the ad-hoc snippet in §9. Full operator runbook:
     `infra/deploy/backup/README.md`.

### 2. KYC age-verification (SumSub / Veriff)

- **WHAT.** Server-side age-verification port (SumSub + Veriff adapters
  plus a `noop` fallback) wired into matchmaking. With `KYC_REQUIRED=true`
  the `mm:join` event refuses users without `Profile.ageVerifiedAt` — the
  /settings#account tile deep-links them to a provider-hosted ID + liveness
  flow. Without it the platform meets the 18+ self-attestation bar only.
- **WHEN to revisit.** When the legal / payments surface demands stronger
  age-proof than the on-register checkbox, or when a payment provider asks
  for it. Both vendors bill **per verification (~€1 each)** — flipping the
  switch with thousands of users would generate a real invoice overnight.
- **HOW to enable.** `KYC_PROVIDER=noop` + `KYC_REQUIRED=false` ship as the
  uncommented defaults (gate OFF). To switch on:
  1. Pick a provider, set `KYC_PROVIDER=sumsub` (or `veriff`) in `/opt/ruletka/.env`.
  2. Uncomment + fill the matching credential block (`SUMSUB_APP_TOKEN` +
     `SUMSUB_SECRET_KEY`, or `VERIFF_API_KEY` + `VERIFF_PRIVATE_KEY`).
  3. Test the flow E2E with `KYC_REQUIRED=false` (informational tile only).
  4. Once the round-trip works, flip `KYC_REQUIRED=true` to enforce the gate.
  5. Full snippet + dashboard webhook setup in §12.

### 3. Mobile on-device NSFW classifier (TFLite)

- **WHAT.** A `nsfw.tflite` binary the mobile app loads to flag NSFW frames
  on-device (twin of the web's `nsfwjs`). Without it the mobile screening
  pipeline still runs (frame sampling, local cut, evidence POST to
  `/moderation/frame`) but the classifier is a no-op — frames are reported
  but never flagged client-side. The server-side Sightengine
  second-opinion (§3 above) applies independently of this asset.
- **WHEN to revisit.** Once the mobile app has a real install base (the
  client is the only consumer of this asset; until then it's wasted bytes
  in the APK). On-device classification itself is **free** — this is purely
  postponed shipping a 5 MB binary.
- **HOW to enable.**
  1. Provision the gantman/nsfw_model MobileNetV2 binary per
     `apps/mobile/assets/models/README.md` (224×224, 5 classes Drawings /
     Hentai / Neutral / Porn / Sexy).
  2. Drop it at `apps/mobile/assets/models/nsfw.tflite`.
  3. Rebuild the mobile APK (the asset bakes into the bundle).
  4. No server-side step — Sightengine moderation is unchanged.

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
`/api/metrics` open to the public edge.

**Self-heals on every deploy.** If an older `.env` is missing the key (e.g.
the server was installed before this var became required — the exact failure
we hit today), the next bootstrap run's `upsert_env` pass detects the gap
and writes a fresh token automatically. No operator step.

To read it back:

```bash
grep -E '^METRICS_TOKEN=' /opt/ruletka/.env | cut -d= -f2-
```

Pass that value as `Authorization: Bearer …` from your Prometheus scrape config.
To rotate, generate a new one, replace via `sed -i`, restart api, and update
the Prometheus config in lockstep.

---

## 5. Mongo authentication

**Nothing to do** on a fresh first deploy — and **nothing to do on an upgrade
from an older `.env`** either. `bootstrap.sh` covers three scenarios:

1. **Fresh `.env`** — generates all four secrets in the one-time heredoc:
   - `infra/secrets/mongo-keyfile` — `openssl rand -base64 756`, chmod 400 (the
     replica-set internal keyFile bind-mounted into all three nodes).
   - `MONGO_ROOT_USERNAME=root` + `MONGO_ROOT_PASSWORD=<openssl rand -hex 24>`.
   - `MONGO_APP_USERNAME=app` + `MONGO_APP_PASSWORD=<openssl rand -hex 24>` (the
     least-privilege user the API connects as).
   - `MONGODB_URI=mongodb://app:<pw>@mongo1:27017,mongo2:27017,mongo3:27017/ruletka?replicaSet=rs0&authSource=ruletka&…`.

2. **Pre-existing `.env` that pre-dates the Mongo-auth rollout** — bootstrap's
   `upsert_env` self-heal pass runs on every deploy, so missing `MONGO_*` keys
   are upserted with safe defaults (`root` / `app` usernames + fresh 24-byte
   hex passwords), and a `MONGODB_URI` that's empty or still uses the dev
   `directConnection` format is rebuilt as the canonical replica-set URI.

3. **Mongo nodes already booted under `--auth --keyFile` with NO users** (lost
   the image-entrypoint root-creation race — today's exact failure mode):
   bootstrap waits for `mongo1` to answer `ping`, then uses the **MongoDB
   localhost-exception** to create the root user on the `admin` db and the
   least-privilege `app` user on the `ruletka` db. The exception only works
   while `admin.system.users` is empty — re-running this step after users
   exist is a clean no-op (it confirms root authenticates and exits).

The credentialed `MONGODB_URI` in `.env` is built from the four secrets and is
the single source of truth (compose reads it via `${MONGODB_URI:?…}`).

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

## 9. S3 backup bucket (Mongo + keyFile nightly — REQUIRED for launch)

The `backup` sidecar (defined in `infra/docker/docker-compose.prod.yml`) runs
nightly at **03:30 UTC**: gzipped `mongodump` of the entire `ruletka` db plus
a tar of the replica-set keyFile, both uploaded to S3 under
`s3://$S3_BACKUP_BUCKET/mongo/<TIMESTAMP>/`. Retention is **30 days** by
default; anything older is deleted in the same run. Full operator runbook:
**`infra/deploy/backup/README.md`** (bucket setup, restore drill, alerting).

The compose's prod gate (`${S3_BACKUP_*:?…}`) refuses to start the `backup`
service if any of the five bucket vars is blank — backups cannot silently
fail to start. Install them BEFORE the first `bootstrap.sh` run, or right
after if you skipped them.

| Var | What it is | Where to get it |
|---|---|---|
| `S3_BACKUP_BUCKET` | Bucket name. Private ACL + server-side encryption ON. | Timeweb-S3 / AWS S3 console — see runbook for the create-bucket steps |
| `S3_BACKUP_ACCESS_KEY_ID` | Access key id, scoped to ONLY this bucket (PutObject + DeleteObject + ListBucket). **Do not reuse root credentials.** | Same console → Access keys → Create key |
| `S3_BACKUP_SECRET_ACCESS_KEY` | Matching secret. Treated like a JWT secret. | Same — shown exactly ONCE; save it immediately |
| `S3_BACKUP_REGION` | Bucket region label. | Timeweb: `ru-1`. AWS: e.g. `us-east-1` |
| `S3_BACKUP_ENDPOINT_URL` | Custom S3 endpoint. Backup script always passes `--endpoint-url`. | Timeweb: `https://s3.timeweb.cloud`. AWS: leave standard regional endpoint |
| `BACKUP_RETENTION_DAYS` | Days of snapshots to keep. Defaults to 30. | literal |
| `ALERT_WEBHOOK_URL` | OPTIONAL. POSTed `{status, timestamp, bucket, key_prefix, message}` on success / failure. Track O (Telegram alerting) wires its bot URL here once it lands. | leave blank until that lands |

```bash
cd /opt/ruletka

# 1) Install the bucket env. ALL CAPS placeholders → paste real values.
S3_BACKUP_BUCKET='<PASTE_BUCKET_NAME_HERE>'                       # e.g. ruletka-backups-prod
S3_BACKUP_ACCESS_KEY_ID='<PASTE_ACCESS_KEY_ID_HERE>'              # scoped to ONLY this bucket
S3_BACKUP_SECRET_ACCESS_KEY='<PASTE_SECRET_ACCESS_KEY_HERE>'      # shown once at create
S3_BACKUP_REGION='ru-1'                                           # Timeweb default; AWS = the region you picked
S3_BACKUP_ENDPOINT_URL='https://s3.timeweb.cloud'                 # AWS leave standard regional endpoint
BACKUP_RETENTION_DAYS='30'

for KV in \
  "S3_BACKUP_BUCKET=${S3_BACKUP_BUCKET}" \
  "S3_BACKUP_ACCESS_KEY_ID=${S3_BACKUP_ACCESS_KEY_ID}" \
  "S3_BACKUP_SECRET_ACCESS_KEY=${S3_BACKUP_SECRET_ACCESS_KEY}" \
  "S3_BACKUP_REGION=${S3_BACKUP_REGION}" \
  "S3_BACKUP_ENDPOINT_URL=${S3_BACKUP_ENDPOINT_URL}" \
  "BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS}"; do
  K="${KV%%=*}"
  sed -i "/^${K}=/d" .env && echo "${KV}" >> .env
done

# 2) Bring the backup sidecar up (no rebuild — scripts are bind-mounted).
COMPOSE="docker compose --env-file .env -f infra/docker/docker-compose.prod.yml"
$COMPOSE up -d --no-deps backup

# 3) Smoke test: run an ad-hoc backup. Should finish with a "SUCCESS:" line
#    and a new <TS>/ prefix should appear in the bucket.
$COMPOSE exec backup /usr/local/bin/backup-mongo.sh

# 4) Confirm the snapshot landed.
$COMPOSE exec backup sh -lc 'aws --endpoint-url "$S3_BACKUP_ENDPOINT_URL" s3 ls s3://$S3_BACKUP_BUCKET/mongo/ | tail -3'
```

**Rotate** the access key in the bucket dashboard at least once a year and
within 24h of any suspected leak: create a new key, swap the two `*_KEY_*` env
vars via `sed`, restart the `backup` sidecar, then revoke the old key.

**Restore drill** — run quarterly. The runbook
(`infra/deploy/backup/README.md` → "Restore drill") has the exact commands
for both **drill A** (throwaway local Mongo) and **drill B** (full-cluster
rebuild from a snapshot). Record the outcome in `LAUNCH-CHECKLIST.md`.

> The `restore-mongo.sh` script REFUSES to run when `MONGODB_URI` looks like
> the prod RS (mongo1/2/3:27017) — you have to set `FORCE_RESTORE_PROD=1`
> explicitly. This is by design, so the drill cannot accidentally wipe prod.

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

## 10. HTTPS-cert expiry watcher + Telegram alerts

The `cert-watch` sidecar (defined in `infra/docker/docker-compose.prod.yml`)
runs a daily script (`infra/deploy/nginx/cert-watch.sh`) at **06:00 UTC**
that:

1. Probes the live listener with `openssl s_client -servername $CERT_WATCH_DOMAIN
   -connect $CERT_WATCH_DOMAIN:443` and reads the cert's notAfter via
   `openssl x509 -noout -enddate`.
2. Falls back to `/etc/letsencrypt/live/$CERT_WATCH_DOMAIN/cert.pem` when
   the live probe fails (DNS hiccup, edge down mid-deploy).
3. Writes the computed `days_left` integer to `/var/lib/cert-watch/days_left.txt`
   on a shared docker volume (`cert-watch-data`). The **API container mounts
   the same volume**, and `CertExpiryHealth`
   (`apps/api/src/observability/health/cert-expiry.health.ts`) reads the file
   at every `/metrics` scrape to publish the **`ruletka_cert_expiry_days{domain}`**
   Prometheus gauge — same `/api/metrics` endpoint already in use, no extra
   exporter.
4. Posts a Telegram alert (*"⚠️ HTTPS cert expires in N days for $CERT_WATCH_DOMAIN"*)
   when `days_left < CERT_WATCH_WARNING_DAYS` (default **14**), using the
   shared track-O bot env (`TELEGRAM_ALERT_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID`).
   Telegram is the on-call signal that doesn't depend on a working dashboard
   at 03:00; the Prometheus gauge is the durable signal Alertmanager pages
   on regardless.

The Prometheus path works with NO operator env — `CERT_WATCH_DOMAIN` defaults
to `ruletka.top` and `CERT_WATCH_WARNING_DAYS` to 14. Telegram alerts are a
clean no-op when either token/chat-id is blank.

**Operator steps.**

```bash
cd /opt/ruletka

# 1) (OPTIONAL) Override the defaults — usually leave them.
# sed -i '/^CERT_WATCH_DOMAIN=/d'        .env && echo 'CERT_WATCH_DOMAIN=ruletka.top'     >> .env
# sed -i '/^CERT_WATCH_WARNING_DAYS=/d'  .env && echo 'CERT_WATCH_WARNING_DAYS=14'        >> .env

# 2) Install the Telegram bot creds (RECOMMENDED — without these you get the
#    Prometheus gauge but no Telegram ping).
#    a) BotFather → /newbot → record TOKEN.
#    b) From the chat/channel you want alerts in, send the bot any message,
#       then read the chat_id via:
#       curl "https://api.telegram.org/bot${TOKEN}/getUpdates" | jq '.result[].message.chat.id'
TELEGRAM_ALERT_BOT_TOKEN='<PASTE_TELEGRAM_BOT_TOKEN_HERE>'   # 123456789:AAAA…
TELEGRAM_ALERT_CHAT_ID='<PASTE_TELEGRAM_CHAT_ID_HERE>'       # e.g. -1001234567890 for a channel

for KV in \
  "TELEGRAM_ALERT_BOT_TOKEN=${TELEGRAM_ALERT_BOT_TOKEN}" \
  "TELEGRAM_ALERT_CHAT_ID=${TELEGRAM_ALERT_CHAT_ID}"; do
  K="${KV%%=*}"
  sed -i "/^${K}=/d" .env && echo "${KV}" >> .env
done

# 3) Bring the sidecar up.
docker compose --env-file .env -f infra/docker/docker-compose.prod.yml up -d cert-watch
```

**Smoke tests.**

```bash
# The sidecar writes days_left.txt at boot — verify it landed inside ~10s.
docker exec ruletka-cert-watch cat /var/lib/cert-watch/days_left.txt
# Expect: a positive integer (e.g. "73"). -1 means the watcher could not
# determine expiry (both live TLS and the PEM fallback failed) — investigate
# DNS + the letsencrypt volume.

# Confirm the API surfaces the gauge.
TOKEN="$(grep -E '^METRICS_TOKEN=' /opt/ruletka/.env | cut -d= -f2-)"
curl -fsS -H "Authorization: Bearer $TOKEN" https://api.ruletka.top/api/metrics \
  | grep ruletka_cert_expiry_days
# Expect: ruletka_cert_expiry_days{domain="ruletka.top"} 73

# (OPTIONAL) Force a Telegram test by lowering the threshold above the actual
# days remaining. Reset it back to 14 afterwards.
sed -i 's/^CERT_WATCH_WARNING_DAYS=.*/CERT_WATCH_WARNING_DAYS=999/' /opt/ruletka/.env
docker compose --env-file .env -f infra/docker/docker-compose.prod.yml up -d cert-watch
docker exec ruletka-cert-watch /usr/local/bin/cert-watch.sh
# → Telegram message in the chat. Then reset:
sed -i 's/^CERT_WATCH_WARNING_DAYS=.*/CERT_WATCH_WARNING_DAYS=14/' /opt/ruletka/.env
docker compose --env-file .env -f infra/docker/docker-compose.prod.yml up -d cert-watch
```

**Prometheus alerting recipe.**

```yaml
# Pair with the existing METRICS_TOKEN bearer scrape config.
groups:
  - name: ruletka-cert-watch
    rules:
      - alert: HttpsCertExpiringSoon
        expr: ruletka_cert_expiry_days >= 0 and ruletka_cert_expiry_days < 14
        for: 30m
        labels: { severity: warning }
        annotations:
          summary: "HTTPS cert for {{ $labels.domain }} expires in {{ $value }}d"
      - alert: HttpsCertWatcherBroken
        expr: ruletka_cert_expiry_days < 0
        for: 1h
        labels: { severity: warning }
        annotations:
          summary: "cert-watch sidecar broken — cannot determine expiry for {{ $labels.domain }}"
```

The two-rule split lets you distinguish "the CERT is about to expire" (page
loud) from "the WATCHER is broken" (page quieter / wake-up-time only).

---

## 11. Telegram alerting — API FATAL + nginx 5xx burst (HIGHLY RECOMMENDED)

**What it is.** A two-surface paging pipeline that delivers a Markdown-V2
message to the operator chat as soon as either:

1. the API logs an `error` or `fatal` (caught by the pino `hooks.logMethod`
   tap wired in `apps/api/src/app.module.ts` → `AlertingService.notify`), OR
2. nginx emits more than `NGINX_5XX_THRESHOLD` 5xx responses inside
   `NGINX_WINDOW_SECONDS` (caught by the `nginx-watchdog` sidecar tailing
   the shared access-log volume).

**Each surface throttles INDEPENDENTLY.** The API throttles per `category`
at 1 message / 10s (with suppressed events collapsed into a `(+N suppressed)`
follow-up). The watchdog throttles at one Telegram POST per
`NGINX_THROTTLE_SECONDS` (default 60s). A crash that takes the API offline
still pages via the watchdog; a slow upstream the watchdog can't see still
pages via the API.

**Where to get the values.**

| Variable | Source |
|---|---|
| `TELEGRAM_BOT_TOKEN` | `@BotFather` on Telegram → `/newbot` → copy the `123456:ABC…` token. |
| `TELEGRAM_ALERT_CHAT_ID` | For a private channel: add the bot as admin, send any message, then `curl https://api.telegram.org/bot<TOKEN>/getUpdates` and read `result[].channel_post.chat.id`. For a 1-1 chat: `curl …/getUpdates` after DM-ing the bot, read `result[0].message.chat.id`. |
| `NGINX_5XX_THRESHOLD` / `NGINX_WINDOW_SECONDS` | Defaults `20 / 60` match the spec. Raise both for a noisier baseline. |

The API-side AlertingService ALSO accepts the older `TELEGRAM_ALERT_BOT_TOKEN`
name (used by the cert-watch sidecar — §10), so a single token serves both
sidecars + the API. Recommended: set `TELEGRAM_BOT_TOKEN`.

**Install.**

```bash
cd /opt/ruletka

TELEGRAM_BOT_TOKEN='<PASTE_BOT_TOKEN_HERE>'
TELEGRAM_ALERT_CHAT_ID='<PASTE_CHAT_ID_HERE>'

sed -i '/^TELEGRAM_BOT_TOKEN=/d' .env \
  && echo "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}" >> .env

sed -i '/^TELEGRAM_ALERT_CHAT_ID=/d' .env \
  && echo "TELEGRAM_ALERT_CHAT_ID=${TELEGRAM_ALERT_CHAT_ID}" >> .env

# Optional tuning:
# sed -i '/^NGINX_5XX_THRESHOLD=/d'     .env && echo 'NGINX_5XX_THRESHOLD=20'     >> .env
# sed -i '/^NGINX_WINDOW_SECONDS=/d'    .env && echo 'NGINX_WINDOW_SECONDS=60'    >> .env
# sed -i '/^NGINX_THROTTLE_SECONDS=/d'  .env && echo 'NGINX_THROTTLE_SECONDS=60'  >> .env

# Apply: bounce the API (picks up the env in onModuleInit) AND the watchdog.
$COMPOSE --env-file .env -f infra/docker/docker-compose.prod.yml \
  up -d --no-deps api nginx-watchdog
```

**Smoke test.**

```bash
# 1) API surface: tail logs and force-fail one request.
$COMPOSE -f infra/docker/docker-compose.prod.yml logs --tail 10 api | grep -i alerting
# (expect: "Telegram alerting enabled.")

# 2) nginx watchdog surface: send 25 requests at a known-500 path.
for i in $(seq 1 25); do curl -s -o /dev/null https://ruletka.top/api/_force-500 || true; done
# (expect: a "🚨 nginx 5xx burst" message in the chat within ~60s)
```

**Graceful degradation.** If `TELEGRAM_BOT_TOKEN` is blank: the API logs
ONE warning at boot ("Telegram alerting DISABLED…") and `AlertingService.notify`
becomes a no-op; the watchdog logs a single stderr line and stays alive in
passive-tail mode. No restart will EVER fail because of a missing alerting
secret.

---

## 12. KYC age-verification (SumSub / Veriff — OPTIONAL; OFF by default)

**Background.** The API ships a **provider port** (`apps/api/src/modules/kyc/`)
with three adapters: **SumSub** (`api.sumsub.com`), **Veriff**
(`stationapi.veriff.com`), and `noop` (the default — onboarding keeps working
unchanged). The matchmaking gate that consults the resulting
`Profile.ageVerifiedAt` is **opt-in via `KYC_REQUIRED`** (default OFF), so this
ships without changing any user's flow until you flip the switch.

**Two operator decisions:**

1. **Which provider?** Set `KYC_PROVIDER=sumsub|veriff|noop` in
   `/opt/ruletka/.env`. With the chosen provider's credentials missing, the
   orchestrator silently falls back to `noop` so onboarding never breaks
   (logged as a `KycModule` warn at boot).
2. **Enforce or just offer?** Set `KYC_REQUIRED=true` to make the matchmaking
   `mm:join` event refuse users without `Profile.ageVerifiedAt` (a `forbidden`
   ws:error with `message=KYC_REQUIRED:/settings#account` is emitted, and the
   web tile deep-links from there). Default `false` keeps the tile
   informational — users may still verify voluntarily.

### Where to get the credentials

- **SumSub.** From your SumSub Console (https://cockpit.sumsub.com): →
  **Integrations → API Keys → Token** (copy `SUMSUB_APP_TOKEN`) and
  **Secret Key** (copy `SUMSUB_SECRET_KEY`). Optionally override
  `SUMSUB_LEVEL_NAME` if your workspace ships a custom verification level (the
  platform default is `id-and-liveness`).
- **Veriff.** From Veriff Station (https://station.veriff.com): → **Settings
  → Integrations → API keys**. The **API key** maps to `VERIFF_API_KEY`
  (sent as the `X-AUTH-CLIENT` header on outbound calls); the **Shared secret
  key** maps to `VERIFF_PRIVATE_KEY` (used for the HMAC signature on outbound
  + inbound webhooks).

### Install on the box

```bash
ssh ruletka.top
sudo -i
cd /opt/ruletka

# Pick ONE provider, leave the other empty.
$EDITOR .env
# Then add:
#   KYC_PROVIDER=sumsub        # or veriff
#   KYC_REQUIRED=false         # keep OFF until you've tested the provider flow E2E
#   SUMSUB_APP_TOKEN=<paste>
#   SUMSUB_SECRET_KEY=<paste>
# OR:
#   VERIFF_API_KEY=<paste>
#   VERIFF_PRIVATE_KEY=<paste>

docker compose -f infra/docker/docker-compose.prod.yml --env-file .env restart api
# Then confirm the boot log either:
#   - says nothing about kyc (real provider is active), or
#   - says "KYC_PROVIDER=<x> but credentials missing — falling back to noop"
```

### Switching provider

Switching is an `.env` edit + an API restart — same shape as
`PAYMENT_PROVIDER`. Existing in-flight `pending` verification rows for the
previously-active provider become orphaned (the webhook handler 400s on a
provider mismatch); a user can simply press **Начать проверку** again to
open a fresh session against the new provider.

### Configure the webhook URL with the provider

Both providers POST signed JSON to `POST /kyc/webhook/:provider`:

- SumSub: dashboard → **Integrations → Webhooks** →
  `https://api.ruletka.top/api/kyc/webhook/sumsub`. Algorithm: **HMAC SHA-256**
  with `SUMSUB_SECRET_KEY` over the raw body (the platform verifies the
  `X-Payload-Digest` header).
- Veriff: dashboard → **Integrations → Webhooks → Decision** →
  `https://api.ruletka.top/api/kyc/webhook/veriff`. The platform verifies the
  `X-HMAC-SIGNATURE` header (hex SHA-256 HMAC of the raw body using
  `VERIFF_PRIVATE_KEY`).

Both endpoints are PUBLIC (no JWT) and signature-verified — same model as the
T-Bank webhook. The handler is **idempotent** on `(provider, externalId)` so
the providers' retries are safe.

---

## Final checklist before opening to users

- [ ] §1 Turnstile — both keys installed, register flow blocked-then-solved in a private window.
- [ ] §2 T-Bank — keys installed, `TBANK_IS_TEST=false` AFTER a real-card test, webhook configured in T-Bank dash.
- [ ] §3 Sightengine — credentials installed, `FRAME_SCORER=provider`, a test report shows a real provider call in API logs.
- [ ] §4 `METRICS_TOKEN` — Prometheus scrape returns 200 with the bearer; without it returns 401.
- [ ] §5 Mongo auth — `$COMPOSE exec -T mongo1 mongosh ruletka --quiet -u <root> -p <root pw> --authenticationDatabase admin --eval 'db.getUsers()'` returns both `root` and `app` users.
- [ ] §8 Index sync — boot log shows "Mongo index sync complete.", then `RUN_INDEX_SYNC=false` set.
- [ ] §10 cert-watch — `docker exec ruletka-cert-watch cat /var/lib/cert-watch/days_left.txt` shows a positive integer; `curl -H "Authorization: Bearer $METRICS_TOKEN" .../api/metrics | grep ruletka_cert_expiry_days` returns the gauge; (optional) `TELEGRAM_ALERT_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID` installed and the threshold-bump smoke test posted a real Telegram message.
- [ ] §11 Telegram alerting — `TELEGRAM_BOT_TOKEN` + `TELEGRAM_ALERT_CHAT_ID` installed, "Telegram alerting enabled." appears in API boot logs, force-500 smoke test posts a real "🚨 nginx 5xx burst" message.
- [ ] **ROTATE** `TURNSTILE_SECRET` + `TBANK_PASSWORD` within the first week post-launch (provider dash → re-issue → re-run §1 / §2).
- [ ] Back up `/opt/ruletka/.env` (chmod 600) and `infra/secrets/mongo-keyfile` (chmod 400) to your password manager / vault. **Do NOT commit them.**

— End of runbook.
