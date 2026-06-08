# ruletka.top — Launch Readiness Checklist

> What it takes to open the platform to real people. The **code** is being
> finished in build waves (see `PLATFORM-BACKLOG.md`); this file is the
> **operational** side — the secrets you must provision and the checks to run
> before launch. Items marked 🔑 require YOU (external accounts / keys).

---

## 1. Secrets to provision (runtime config — server `.env`)

| Key | For | Status | Where to get it |
|---|---|---|---|
| 🔑 `CLOUDPAYMENTS_PUBLIC_ID` + `CLOUDPAYMENTS_API_SECRET` | **Premium + coin revenue** (wave 2 builds the server checkout/cancel/refund; it needs these to actually charge) | **MISSING** → premium is uncollectable until set | CloudPayments dashboard → Site settings → API |
| 🔑 `NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID` | web payment widget | **MISSING** | same Public ID (safe to expose) |
| 🔑 `SIGHTENGINE_API_USER` + `MODERATION_PROVIDER_API_KEY` | **server-side NSFW screening** of call frames (today it fails-open → trusts the client) | **MISSING** → no real AI moderation | sightengine.com (or chosen provider) |
| 🔑 `TURNSTILE_SECRET` (+ public site key) | anti-bot on signup/login | **MISSING → now REQUIRED in prod** (the API boot now fails-fast without it — security hardening) | Cloudflare Turnstile (free) |
| `SMTP_*` (host/user/pass) | email verify / password reset | **SET** (server `.env`) | — verify deliverability |
| `TURN_STATIC_AUTH_SECRET` + `TURN_REALM` | WebRTC relay (calls behind NAT) | **SET** (coturn) | — |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | auth | **SET** (generated) | — |
| `COOKIE_DOMAIN=.ruletka.top` | cross-subdomain cookies | **SET** | — |
| `FIREBASE_SERVICE_ACCOUNT` | **native mobile push** (FCM HTTP v1 — FCM on Android, APNs-via-FCM on iOS). Blank → mobile push is a clean NO-OP (in-app + socket delivery unaffected) and the API WARNs once at boot | **MISSING** → no native push on mobile until set | Firebase console → Project settings → Service accounts → "Generate new private key". Paste the JSON (or its base64) into the env var. |

**Mobile Firebase config files** (operator-supplied PROJECT SECRETS — NOT in the repo; needed for the mobile app to obtain an FCM/APNs token; the app still builds + boots without them, push just stays a no-op):
- `apps/mobile/android/app/google-services.json` — Android FCM config (Firebase console → Project settings → Your apps → Android). **Also** apply the `com.google.gms.google-services` Gradle plugin: add `id("com.google.gms.google-services") version "4.4.x" apply false` to `apps/mobile/android/settings.gradle.kts` and `id("com.google.gms.google-services")` to `apps/mobile/android/app/build.gradle.kts`. (Left out of the repo on purpose — the google-services plugin fails the build if the JSON is absent.)
- `apps/mobile/ios/Runner/GoogleService-Info.plist` — iOS config (Firebase console → iOS app), plus an **APNs auth key** uploaded in Firebase console → Cloud Messaging → Apple app configuration, and the Push Notifications + Background Modes (Remote notifications) capabilities in Xcode.

**Mobile on-device NSFW model** (operator-provisioned binary — NOT in the repo; needed for the mobile app's on-device video moderation to be **active**):
- `apps/mobile/assets/models/nsfw.tflite` — the gantman/nsfw_model MobileNetV2 (224×224, 5 classes Drawings/Hentai/Neutral/Porn/Sexy), the TFLite twin of the web's nsfwjs (see `apps/mobile/assets/models/README.md` for the exact spec + how to provision). **Without it** the mobile screening pipeline still runs (frame sampling, local blur/cut, evidence POST to `/moderation/frame`) but **never flags** — the classifier degrades to a no-op, so a clean user is never falsely cut. The **server-side Sightengine second-opinion still applies** once its 🔑 keys are set, independent of this asset.

**Bottom line:** to actually **earn money** you need the 🔑 CloudPayments keys; to **moderate for real** you need the 🔑 Sightengine keys (server-side) and, for on-device mobile flagging, the `nsfw.tflite` asset above; for **native mobile push** you need `FIREBASE_SERVICE_ACCOUNT` (server) + the two mobile config files above. Everything else is wired.

## 2. Pre-launch verification (do on staging before opening)

- [ ] **Visual QA pass** of the new FE (typecheck-green but not yet clicked live): friends/chats **pagination "Load more"**, web **"Confirm & ban"**, admin **premium-plan CRUD**, **active-sessions/devices** UI, **friend-call** entry points.
- [ ] **2-peer call test** (two browsers/devices): video roulette + voice roulette + **direct friend call** (`/video?to=`) → offer/answer/ICE/connected/next/leave; camera+mic toggle; reconnection on drop.
- [ ] **Payment test with REAL CloudPayments keys**: buy a coin package, buy a paid cover, subscribe to premium, cancel (verify billing stops), admin refund.
- [ ] **Moderation flow**: report a user → admin/web "Confirm & ban" → banned user sees `banReason` at login → appeal.
- [ ] **Email**: register → verify-email link works; password reset works.
- [ ] **Mobile**: new logo + first-launch preloader; calls; `mod:action`; the `/mm` socket-teardown fix (presence survives leaving roulette).
- [ ] **Load/abuse smoke**: WS rate limits, concurrent-socket cap, matchmaking under a few hundred queued.

## 3. Launch sequence

1. Provision the 🔑 keys above on the server `.env`.
2. Merge `polish/web-dark-default` → `main` (carries: dark theme + new logo/preloader + design-system unification + P0/P1 waves 1–2).
3. Auto-deploy (server-side systemd pull-deploy) → smoke-test each subdomain (web / api / admin).
4. **DB index migration (one-off, REQUIRED).** Production runs with `autoIndex` OFF, so indexes are reconciled explicitly. On a fresh DB just boot the API once with `RUN_INDEX_SYNC=true` (creates every schema index, then unset it). On an EXISTING DB two index changes are destructive and must be de-duped first or the loud `syncIndexes()` will (correctly) abort boot:
   - **Payments** — `transactionId` is promoted to `{unique, sparse}`. Find collisions, resolve, then let `RUN_INDEX_SYNC=true` drop+recreate it:
     `db.payments.aggregate([{$match:{transactionId:{$ne:null}}},{$group:{_id:"$transactionId",n:{$sum:1}}},{$match:{n:{$gt:1}}}])`
   - **Appeals** — new partial-unique `{userId}` over `status:"pending"`. Resolve any user with two open appeals first:
     `db.moderation_appeals.aggregate([{$match:{status:"pending"}},{$group:{_id:"$userId",n:{$sum:1}}},{$match:{n:{$gt:1}}}])`
   - **Friends + Matches (perf-only, NO dedup needed)** — the same boot reconciles two index reshuffles that are all **non-unique**, so there is nothing to de-dup first: `syncIndexes()` simply CREATES the new compounds and DROPS the now-orphaned old/redundant ones in one pass.
     - `friendships`: `{requesterId,status}`/`{recipientId,status}` → `{requesterId,status,createdAt:-1}`/`{recipientId,status,createdAt:-1}` (carry `createdAt` so the newest-first list sort is index-served; old 2-key indexes dropped as redundant prefixes).
     - `cointransactions`: pure-add `{userId,_id:-1}` for the `_id`-keyset transactions pager (existing `{userId,createdAt:-1}` kept).
     - `wallets`: pure-add `{balanceCoins:-1}` for the leaderboard coins board.
     - `matches`: drop the redundant single-field indexes on `userA`/`userB`/`startedAt` (dead prefixes of the `{userA,startedAt}`/`{userB,startedAt}`/`{type,startedAt}` compounds; trims write amplification on the highest-write collection).
   - Then boot once with `RUN_INDEX_SYNC=true` (it AWAITS + throws loudly on any remaining conflict — boot aborts rather than shipping green-but-unprotected), confirm "Mongo index sync complete." in logs, and unset the flag for normal boots.
5. Run the §2 checks on production with a small allow-list / soft launch.
6. Open to people.

## 4. Known infra note — RF access

Access from inside Russia is degraded by **ТСПУ (state DPI)**, not by code/RKN — large packets to the current Timeweb IP are throttled/dropped (Timeweb-confirmed). The **Kazakhstan server migration** is the planned fix: provision the KZ box, add the deploy SSH key, migrate Mongo data, repoint DNS. Until then, RF users need a non-RF DNS resolver + may see slow loads.

## 5. After launch (continuous)

Work the rest of `PLATFORM-BACKLOG.md` (P1/P2): gift→payout model, renewal Payment rows, refund UI, top-placement auction/expiry, image DMs, TURN ttl/ICE-restart polish, mobile feature parity, perf + observability.
