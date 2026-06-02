# 🎰 ruletka.top

Production-grade video & voice roulette platform (Omegle/Chatroulette-class) with a social layer
and in-app economy. Monorepo managed with **pnpm workspaces** + **Turborepo**.

> Product & architecture source of truth: [`PROJECT_SPEC.md`](./PROJECT_SPEC.md).

## Stack

| Layer    | Tech                                                                     |
| -------- | ------------------------------------------------------------------------ |
| Web      | Next.js 16 (App Router, RSC), React 19, TypeScript 6, Tailwind v4        |
| API      | NestJS 11, Mongoose 9 (MongoDB), Socket.io, Redis (ioredis), BullMQ      |
| Realtime | WebRTC (P2P), coturn (STUN/TURN), Socket.io signaling                    |
| Mobile   | Flutter (flutter*webrtc) — \_planned*                                    |
| Payments | CloudPayments (widget + webhooks + recurrent)                            |
| Shared   | `@ruletka/shared-types` — zod schemas + inferred TS types (the contract) |

## Layout

```
apps/
  web/            # Next.js 16 frontend
  api/            # NestJS 11 backend + WebSocket signaling
  mobile/         # Flutter (planned)
packages/
  shared-types/   # zod DTOs + socket event contracts (single source of truth)
  ui/             # design system: tokens, primitives
  config/         # shared tsconfig presets
infra/
  docker/  coturn/  nginx/
```

## Prerequisites

- Node.js >= 20.9 (`.nvmrc` → 20)
- pnpm 9.15+
- Docker (for MongoDB, Redis, coturn in dev)

## Quickstart

```bash
pnpm install
cp .env.example .env        # fill in secrets
# infra (mongo/redis/coturn) — see infra/docker
pnpm dev                    # runs all apps via turbo
```

## Status

Bootstrapping (Stage 0). See `PROJECT_SPEC.md` §14 for the roadmap.
