# Infrastructure — ruletka.top

Dev and prod infrastructure for the platform: containerized backing services,
a STUN/TURN relay for WebRTC, a reverse-proxy / TLS terminator, and production
multi-stage Dockerfiles for the API and web apps.

```
infra/
├── coturn/
│   └── turnserver.conf          # STUN/TURN config (HMAC time-limited creds)
├── docker/
│   ├── docker-compose.dev.yml   # mongo + redis + coturn (+ optional api/web)
│   ├── api.Dockerfile           # NestJS API — multi-stage, turbo-pruned
│   └── web.Dockerfile           # Next.js web — multi-stage, standalone output
├── nginx/
│   └── nginx.conf               # prod reverse proxy + TLS + Socket.io upgrade
└── README.md
```

---

## Prerequisites

- Docker Engine + Compose v2 (`docker compose`, not the legacy `docker-compose`).
- Node `>=20.9.0` and `pnpm@9` on the host (only needed to run the apps with
  `pnpm dev` against the containerized infra).

---

## Quick start (dev)

All commands run **from the repo root**.

```bash
# 1. Create your env file and fill in the secrets.
cp .env.example .env
#    At minimum set: TURN_STATIC_AUTH_SECRET, JWT_ACCESS_SECRET,
#    JWT_REFRESH_SECRET. The rest have working localhost defaults.

# 2. Start the backing services (mongo, redis, coturn).
docker compose -f infra/docker/docker-compose.dev.yml up -d

# 3. Run the apps on the host against those services.
pnpm install
pnpm dev
```

Stop and remove containers (data volumes persist):

```bash
docker compose -f infra/docker/docker-compose.dev.yml down
```

Wipe everything including the Mongo/Redis volumes:

```bash
docker compose -f infra/docker/docker-compose.dev.yml down -v
```

### Running the apps in containers too

The `api` and `web` services are gated behind the `app` Compose profile so the
default `up` stays lightweight. To build and run the full stack in Docker:

```bash
docker compose -f infra/docker/docker-compose.dev.yml --profile app up -d --build
```

When containerized, the API is pointed at the in-network hostnames
(`mongo`, `redis`, `coturn`) via service-level `environment` overrides, so the
host-oriented values in `.env` (`localhost`) do not need editing.

> **`web.Dockerfile` prerequisite.** The web image uses Next.js standalone
> output. `apps/web/next.config.*` must set `output: 'standalone'` and, because
> this is a monorepo, `outputFileTracingRoot` pointed at the repo root so Next
> traces workspace deps correctly:
>
> ```js
> // apps/web/next.config.mjs
> import path from 'node:path';
> export default {
>   output: 'standalone',
>   outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
> };
> ```

---

## Required environment

Defined in [`.env.example`](../.env.example); copy it to `.env`. Variables the
infra consumes directly:

| Variable                    | Used by          | Notes                                                                                            |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `TURN_STATIC_AUTH_SECRET`   | coturn, api      | HMAC secret for ephemeral TURN creds. **Required.** Server-only — never sent to clients.         |
| `TURN_REALM`                | coturn           | TURN realm advertised to clients (default `ruletka.top`).                                        |
| `REDIS_PASSWORD`            | redis, api       | Empty in dev (no auth). When set, enables `--requirepass` and authenticated healthchecks.        |
| `MONGODB_URI`               | api              | Host default `mongodb://localhost:27017/ruletka`; container override targets `mongo`.            |
| `REDIS_HOST` / `REDIS_PORT` | api              | Host defaults `localhost:6379`; container override targets `redis:6379`.                         |
| `NEXT_PUBLIC_*`             | web (build args) | Inlined into the Next.js bundle at **build** time — pass as `--build-arg` for non-local deploys. |

Secrets (`*_SECRET`, `*_PASSWORD`, API keys) must never be committed; `.env` is
git-ignored.

---

## Exposed ports (dev)

| Service | Host port(s)  | Protocol  | Purpose                          |
| ------- | ------------- | --------- | -------------------------------- |
| mongo   | `27017`       | TCP       | MongoDB wire protocol            |
| redis   | `6379`        | TCP       | Redis                            |
| coturn  | `3478`        | UDP + TCP | STUN / TURN                      |
| coturn  | `5349`        | TCP       | STUN / TURN over TLS (TURNS)     |
| coturn  | `49160-49200` | UDP       | Media relay range (matches conf) |
| api\*   | `4000`        | TCP       | NestJS API (`/api`) + Socket.io  |
| web\*   | `3000`        | TCP       | Next.js                          |

\* Only when started with `--profile app`.

In **production** these app ports sit behind nginx (below); only `80`/`443`
(and coturn's relay ports) are exposed publicly.

---

## coturn credential model (time-limited HMAC)

WebRTC media relay uses coturn's **REST API / ephemeral credential** scheme
(`use-auth-secret` + `static-auth-secret`). There are **no** static per-user
TURN passwords and no per-user state in the database.

- A single shared secret, `TURN_STATIC_AUTH_SECRET`, lives only server-side
  (in the coturn config and in the API env). It is never sent to the browser.
- When a client is about to start a call, the **NestJS API mints** a
  short-lived credential:

  ```
  expiry   = now_unix + ttl            # e.g. now + 3600s
  username = `${expiry}:${userId}`     # unix_ts ":" userId
  password = base64( HMAC_SHA1(TURN_STATIC_AUTH_SECRET, username) )
  ```

  and returns `{ username, credential: password, urls: [...] }` for the client
  to drop into `RTCPeerConnection({ iceServers })`.

- coturn validates by re-deriving the same HMAC from the username and checking
  the embedded timestamp has not passed. Credentials therefore **self-expire**
  and are bound to a `userId` for abuse tracing. Rotating the secret instantly
  invalidates every outstanding credential.

The full scheme (and the validation steps) is documented inline at the top of
[`coturn/turnserver.conf`](./coturn/turnserver.conf).

**Production TURN notes**

- Set `external-ip` in `turnserver.conf` to the server's public IP (or
  `PUBLIC/PRIVATE` for 1:1 NAT) so coturn advertises a routable relay candidate.
  The dev compose overrides the image's default `command`, which means coturn's
  bundled `--external-ip=$(detect-external-ip)` auto-detection is **not** used —
  set `external-ip` explicitly for any deployment behind NAT.
- Mount real TLS certs and uncomment `cert` / `pkey` to serve TURNS on `5349`.
- On Linux, `network_mode: host` is the most robust way to handle the dynamic
  UDP relay range; the dev compose instead publishes the explicit
  `49160-49200/udp` range for Docker Desktop (macOS/Windows) compatibility.
- The dev relay range (`49160-49200`) is intentionally tiny; widen `min-port`/
  `max-port` (and the published range) for real traffic. Each concurrent relayed
  session consumes ports from this range.

---

## Reverse proxy (nginx, production)

[`nginx/nginx.conf`](./nginx/nginx.conf) is the production edge. It is **not**
part of the dev compose (dev talks to the services directly on their published
ports). Deploy it as a container or system nginx in front of the app.

Routing:

| Location      | Upstream   | Notes                                                            |
| ------------- | ---------- | ---------------------------------------------------------------- |
| `/socket.io/` | `api:4000` | WebSocket `Upgrade`/`Connection` headers; 1h read/send timeouts. |
| `/api`        | `api:4000` | REST API.                                                        |
| `/`           | `web:3000` | Next.js (catch-all).                                             |

Other features: HTTP→HTTPS redirect with an ACME challenge location, TLS 1.2/1.3
with cert **path placeholders** (`/etc/nginx/certs/{fullchain,privkey}.pem`),
gzip, and security headers (HSTS, `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, a `Permissions-Policy` that allows camera/mic for WebRTC).

The `proxy_read_timeout` on `/socket.io/` (3600s) is deliberately far larger
than Socket.io's default `pingInterval + pingTimeout` (45s) — nginx must not
close an otherwise-healthy long-lived connection.

---

## Scaling notes

- **Stateless apps.** The API and web images are stateless; scale them
  horizontally by adding replicas / `server` lines to the nginx upstreams.

- **Socket.io across instances.** Real-time fan-out across multiple API
  replicas is handled by `@socket.io/redis-adapter` (already wired into the
  NestJS gateway, backed by the `redis` service). Any node can deliver an event
  to a socket connected to any other node through Redis pub/sub.

- **Sticky sessions.** The adapter does **not** remove the need for sticky
  routing while HTTP long-polling is enabled — long-polling spreads one session
  across several HTTP requests that must all reach the same node, else clients
  get `Session ID unknown` (HTTP 400). `upstream api_backend` in the nginx
  config uses `ip_hash` for this. If the client forces WebSocket-only (no
  polling fallback), a single TCP connection carries the whole session and
  sticky routing becomes optional.

- **Shared state.** Mongo and Redis are the shared stores; in production point
  the apps at managed/replicated clusters (replica set for Mongo, HA Redis) and
  treat the dev compose volumes as ephemeral local state.

- **BullMQ.** Background queues run on the same Redis instance; scale workers by
  running additional API/worker replicas — the queue coordinates them. The
  repeatable sweeps (subscription-expiry, top-expiry, match-reconciliation)
  register with a STABLE `jobId`, so N replicas converge on one schedule rather
  than stacking duplicate timers. Each invocation gets bounded retry + backoff,
  and a permanently-failed job is RETAINED (bounded) in BullMQ's failed set for
  post-mortem inspection. A boot-time Redis blip while registering a sweep
  degrades (loud error log + `ruletka_queue_register_failures_total` metric) and
  re-tries on the next restart instead of crashing the API.

---

## Observability (Prometheus metrics)

Each API instance exposes Prometheus metrics at **`GET /api/metrics`** (behind
the optional `METRICS_TOKEN` bearer gate; `@SkipThrottle`). Beyond the default
`process_*` / `nodejs_*` series, the app emits `ruletka_*` metrics, including the
background-sweep signals:

| Metric                                          | Type    | Labels  | Meaning                                                       |
| ----------------------------------------------- | ------- | ------- | ------------------------------------------------------------- |
| `ruletka_queue_jobs_failed_total`               | counter | `queue` | Sweep jobs that errored — **primary sweep alert**.            |
| `ruletka_queue_jobs_completed_total`            | counter | `queue` | Sweep jobs that ran to success (liveness).                    |
| `ruletka_queue_register_failures_total`         | counter | `queue` | Boot-time failures to register a sweep schedule on a node.    |

Suggested alerts: `increase(ruletka_queue_jobs_failed_total[15m]) > 0` and
`ruletka_queue_register_failures_total > 0` (a sweep may be unscheduled on that
node). A flatlined `ruletka_queue_jobs_completed_total` for a queue past its
cadence also indicates a stuck/unscheduled sweep.

### Scraping BOTH api replicas once scaled

**The metrics are PER-NODE.** Counters like `ruletka_queue_jobs_failed_total`
and the `ruletka_active_socket_connections` gauge live in each process's own
in-memory registry — there is no aggregation across replicas, and they reset to
zero on restart (use `rate()`/`increase()`, and `sum by (queue)` across instances
in Grafana).

The single-node default is fine: nginx pins one `api` upstream
(`upstream api_backend` with `ip_hash`, see [`nginx/nginx.conf`](./nginx/nginx.conf)),
so a scrape to the edge always lands on the one replica. **But once you scale to
≥2 api replicas (`--scale api=2` / an explicit `api-2` service), do NOT scrape
through nginx** — `ip_hash` would pin the scraper to a single replica and you'd
silently miss the others' metrics.

Scrape each replica directly on its own address. Prometheus example
(replicas reachable on the compose network as `api`, `api-2`, …):

```yaml
scrape_configs:
  - job_name: 'ruletka-api'
    metrics_path: /api/metrics
    # If METRICS_TOKEN is set, add:
    #   authorization: { type: Bearer, credentials: '<METRICS_TOKEN>' }
    static_configs:
      # One target per replica — each has its own per-node registry. As you add
      # replicas, add their host:port here (do NOT point this at the nginx edge,
      # which would ip_hash-pin the scraper to a single replica).
      - targets: ['api:4000', 'api-2:4000']
        labels: { service: ruletka-api }
```

Then aggregate in queries, e.g. `sum by (queue) (increase(ruletka_queue_jobs_failed_total[15m]))`.
For dynamic replica counts, prefer service discovery (Docker/DNS SD) over a
static list so new replicas are picked up automatically.
