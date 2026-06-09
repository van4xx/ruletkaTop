# Production notes — ruletka.top

This file captures the production-only nuances that differ from the local dev
setup. The app is **dev/prod-parity by design**; the items below are the few
places where production needs different configuration or topology.

---

## 1. MongoDB — multi-node replica set (transactions)

The economy/auth code uses **multi-document transactions** (atomic wallet debit

- credit, atomic user+profile creation). Transactions require a **replica set**.

|                    | Dev (docker-compose.dev.yml)                                                                                 | Production                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Topology           | Single-node RS `rs0`                                                                                         | **Multi-node RS (≥3 voting members)** or MongoDB Atlas                                                       |
| `MONGODB_URI`      | `…/ruletka?directConnection=true&retryWrites=false`                                                          | `mongodb://h1,h2,h3/ruletka?replicaSet=rs0&retryWrites=true&w=majority` (or the Atlas `mongodb+srv://…` URI) |
| Transactions       | Best-effort; the app **degrades to sequential writes** when the single node reports transactions unsupported | **Fully supported** — real ACID transactions run                                                             |
| `directConnection` | `true` (avoids advertised-host topology flakiness over the mapped port)                                      | **omit it** — the driver must discover the RS topology to route to the primary                               |

### Why the dev fallback exists

A single-node RS can momentarily report transactions as unsupported (e.g. the
node is `SECONDARY`/`STARTUP` during election, or retryable writes are off). To
keep local dev frictionless, `AuthService` / `WalletService` detect this
(`isTransactionUnsupported`) and fall back to **sequential writes**. This
fallback is a **dev convenience only** — on a healthy multi-node prod RS the
transactional path always runs, so there is no atomicity gap in production.

### Production checklist

- Provision a **3-node replica set** (or Atlas M10+). Never run prod on a
  single mongod.
- Use a `MONGODB_URI` **without** `directConnection`, with
  `retryWrites=true&w=majority`.
- Enable auth (`--auth` + keyFile/x509) and TLS between app ↔ db. **DONE for
  self-hosted:** `infra/docker/docker-compose.prod.yml` now runs the RS with
  `--auth --keyFile`, and `infra/deploy/bootstrap.sh` generates the keyFile
  (`infra/secrets/mongo-keyfile`) + a root password + a least-privilege `app`
  user and a credentialed `MONGODB_URI` (see ENV_CHECKLIST.md → "MongoDB
  authentication"). TLS between app↔db is still TODO (the RS is on the isolated
  Docker network); add it for multi-host.
- The reference 3-node compose (keyFile + RS init) lives in
  `infra/docker/docker-compose.prod.yml` — validate it in staging before relying
  on it; managed Atlas is the lower-risk default.

---

## 2. WebRTC / TURN credentials

- Credentials are **HMAC-derived, ephemeral** (coturn `use-auth-secret`); no
  per-user secret is stored.
- TTL is **`TURN_CRED_TTL_SECONDS` (default 1200 = 20 min)** — short on purpose.
  The client fetches a fresh credential per call, so the window only needs to
  cover ICE gathering + setup. Keep it short to bound the blast radius of a
  leaked credential.
- Set a strong, unique `TURN_STATIC_AUTH_SECRET` (≠ the dev placeholder) and run
  coturn behind TLS (`TURN_TLS_PORT`, `turns:`).

---

## 3. Secrets & auth

- Rotate **all** `change-me-*` placeholders: `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `TURN_STATIC_AUTH_SECRET`. Use distinct, high-entropy
  values; never share the access and refresh secrets.
- JWT algorithm is pinned to **HS256** (signing + verification) — keep it pinned.
- Access TTL `900s`, refresh TTL `30d`; the refresh token lives **only** in an
  httpOnly, Secure, SameSite=Strict cookie (`ruletka_rt`, path `/api/auth`).
- argon2 cost (`ARGON2_MEMORY_COST`, `ARGON2_TIME_COST`) — tune up to the
  hardware budget; the defaults are a sane floor.
- **Password policy** (contract-level, `@ruletka/shared-types`): min 8, and a
  strength floor — either 12+ chars (passphrase) or ≥2 character classes. Login
  is unaffected (existing users never locked out).

---

## 4. HTTP edge / API

- **CORS fail-closed**: in prod, `CORS_ORIGINS` MUST be set; an empty list
  rejects all cross-origin requests (dev allows all). Set it to the real web
  origin(s) only.
- **Swagger is gated to non-prod** — `/api/docs` is not served when
  `NODE_ENV=production`. Leave it gated.
- helmet CSP/HSTS + `trust proxy` are on in prod; the Next.js app emits its own
  hardened CSP (see `apps/web/next.config.ts`). `upgrade-insecure-requests` is
  emitted only when the API origin is https.

---

## 5. Horizontal scale (multi-replica API)

- Socket.IO uses the **Redis adapter** for cross-node fan-out — a shared Redis
  is required when the API runs >1 replica (matchmaking + presence + chat
  delivery must reach sockets on any node).
- BullMQ + throttler storage also use Redis. Provision a managed Redis with a
  password (`REDIS_PASSWORD`) and TLS.
- nginx (`infra/nginx/nginx.conf`) must use sticky upgrade handling for the WS
  path when fronting multiple API replicas.
