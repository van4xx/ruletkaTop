# =============================================================================
# api.Dockerfile — NestJS API (apps/api) for ruletka.top
# -----------------------------------------------------------------------------
# Multi-stage, pnpm + Turborepo aware. BUILD CONTEXT IS THE REPO ROOT:
#
#   docker build -f infra/docker/api.Dockerfile -t ruletka-api .
#
# Stages:
#   base    – Node 20 alpine + pnpm via corepack (shared toolchain)
#   pruner  – `turbo prune @ruletka/api --docker` => minimal monorepo subset
#   deps    – install deps from the pruned lockfile (cached unless deps change)
#   builder – copy full pruned source, build only @ruletka/api
#   runner  – slim production image, non-root, runs the compiled dist
# =============================================================================

# ----------------------------- base ----------------------------------------
FROM node:20-alpine AS base
# libc6-compat helps native addons (argon2, etc.) load on alpine/musl.
RUN apk add --no-cache libc6-compat
# Enable pnpm via corepack, pinned EXPLICITLY to 9.15.9. The pruner stage runs
# pnpm BEFORE the repo (whose package.json carries the "packageManager" pin) is
# COPYed in — without an explicit pin here corepack fetches the LATEST pnpm (11.x),
# which requires Node 22 and crashes on this Node 20 base (node:sqlite). Keep this
# version in sync with the root package.json "packageManager" field.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# ----------------------------- pruner ---------------------------------------
# Produce a focused subset of the monorepo for @ruletka/api:
#   out/json  -> package.json files + lockfile (for a cacheable install layer)
#   out/full  -> full source of the app and its workspace deps
FROM base AS pruner
RUN pnpm add -g turbo@^2.9.16
COPY . .
RUN turbo prune @ruletka/api --docker

# ----------------------------- deps -----------------------------------------
# Install ALL deps (incl. dev) against the pruned lockfile. This layer is only
# rebuilt when a relevant package.json or the lockfile changes.
FROM base AS deps
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ----------------------------- builder --------------------------------------
FROM base AS builder
ENV NODE_ENV=production
# node_modules from deps, then the full pruned source on top.
COPY --from=deps /app/ .
COPY --from=pruner /app/out/full/ .
# Build only the api and whatever it depends on in the graph.
RUN pnpm turbo run build --filter=@ruletka/api...
# Strip dev dependencies for a lean runtime node_modules.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ----------------------------- runner ---------------------------------------
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production

# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nestjs

# Production node_modules + compiled output.
#   • /app/node_modules         → the root store (node_modules/.pnpm/* — the real
#                                 package files) + root-level deps.
#   • /app/apps/api/node_modules → the api package's OWN deps, which pnpm keeps as
#                                 symlinks into ../../node_modules/.pnpm. WITHOUT
#                                 this the runtime can't resolve the api's direct
#                                 deps (@sentry/nestjs, @nestjs/*, …) since this
#                                 repo uses pnpm's default isolated node-linker
#                                 (no hoist), and crashes with MODULE_NOT_FOUND.
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder --chown=nestjs:nodejs /app/apps/api/dist ./apps/api/dist

USER nestjs
EXPOSE 4000
# API_PORT defaults to 4000 (see .env.example); the app reads it from env.
ENV API_PORT=4000

CMD ["node", "apps/api/dist/main.js"]
