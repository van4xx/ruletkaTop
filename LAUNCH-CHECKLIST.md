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

**Bottom line:** to actually **earn money** you need the 🔑 CloudPayments keys; to **moderate for real** you need the 🔑 Sightengine keys. Everything else is wired.

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
4. Run the §2 checks on production with a small allow-list / soft launch.
5. Open to people.

## 4. Known infra note — RF access

Access from inside Russia is degraded by **ТСПУ (state DPI)**, not by code/RKN — large packets to the current Timeweb IP are throttled/dropped (Timeweb-confirmed). The **Kazakhstan server migration** is the planned fix: provision the KZ box, add the deploy SSH key, migrate Mongo data, repoint DNS. Until then, RF users need a non-RF DNS resolver + may see slow loads.

## 5. After launch (continuous)

Work the rest of `PLATFORM-BACKLOG.md` (P1/P2): gift→payout model, renewal Payment rows, refund UI, top-placement auction/expiry, image DMs, TURN ttl/ICE-restart polish, mobile feature parity, perf + observability.
