# =============================================================================
# web.Dockerfile — Next.js web app (apps/web) for ruletka.top
# -----------------------------------------------------------------------------
# Multi-stage, pnpm + Turborepo aware. BUILD CONTEXT IS THE REPO ROOT:
#
#   docker build -f infra/docker/web.Dockerfile -t ruletka-web .
#
# Requires apps/web/next.config.* to set `output: 'standalone'`, which emits a
# self-contained server (incl. a pruned node_modules) under
# apps/web/.next/standalone — the canonical Next.js container layout.
#
# Stages:
#   base    – Node 20 alpine + pnpm via corepack
#   pruner  – `turbo prune @ruletka/web --docker` => minimal monorepo subset
#   deps    – install deps from the pruned lockfile (cacheable layer)
#   builder – copy full pruned source, build only @ruletka/web (standalone)
#   runner  – slim production image, non-root, runs the standalone server
# =============================================================================

# ----------------------------- base ----------------------------------------
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
# Pin pnpm EXPLICITLY: the pruner stage runs pnpm before the repo's packageManager
# pin is COPYed in, so without this corepack would fetch the latest pnpm (11.x,
# needs Node 22) and crash on this Node 20 base. Keep in sync with root package.json.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# ----------------------------- pruner ---------------------------------------
FROM base AS pruner
RUN pnpm add -g turbo@^2.9.16
COPY . .
RUN turbo prune @ruletka/web --docker

# ----------------------------- deps -----------------------------------------
FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ----------------------------- builder --------------------------------------
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/ .
COPY --from=pruner /app/out/full/ .
# NEXT_PUBLIC_* envs are inlined at build time. Pass them as build args when the
# values differ per environment, e.g.:
#   docker build --build-arg NEXT_PUBLIC_API_URL=https://ruletka.top/api ...
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID
ARG NEXT_PUBLIC_STUN_URLS
ARG NEXT_PUBLIC_TURN_URLS
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_ANALYTICS_DOMAIN
ARG NEXT_PUBLIC_ANALYTICS_HOST
ARG NEXT_PUBLIC_ASSET_PREFIX
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID=$NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID \
    NEXT_PUBLIC_STUN_URLS=$NEXT_PUBLIC_STUN_URLS \
    NEXT_PUBLIC_TURN_URLS=$NEXT_PUBLIC_TURN_URLS \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_ANALYTICS_DOMAIN=$NEXT_PUBLIC_ANALYTICS_DOMAIN \
    NEXT_PUBLIC_ANALYTICS_HOST=$NEXT_PUBLIC_ANALYTICS_HOST \
    NEXT_PUBLIC_ASSET_PREFIX=$NEXT_PUBLIC_ASSET_PREFIX
RUN pnpm turbo run build --filter=@ruletka/web...

# ----------------------------- runner ---------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Next.js standalone output already bundles the minimal node_modules. For a
# monorepo the standalone folder mirrors the workspace layout, so copy it to
# the image root; the server entry then lives at apps/web/server.js.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
