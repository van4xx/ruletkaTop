import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { SentryModule } from '@sentry/nestjs/setup';
import { LoggerModule } from 'nestjs-pino';

import { CommonModule } from './common/common.module';
import { ThrottlerBehindProxyGuard } from './common/throttler/throttler-behind-proxy.guard';
import { ThrottlerModule } from './common/throttler/throttler.module';
import { HealthModule } from './health/health.module';
import { sentryEnabled } from './instrument';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { ChatModule } from './modules/chat/chat.module';
import { CoversModule } from './modules/covers/covers.module';
import { FriendsModule } from './modules/friends/friends.module';
import { GiftsModule } from './modules/gifts/gifts.module';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
import { MailModule } from './modules/mail/mail.module';
import { MatchmakingModule } from './modules/matchmaking/matchmaking.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PremiumModule } from './modules/premium/premium.module';
import { PresenceModule } from './modules/presence/presence.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TopModule } from './modules/top/top.module';
import { TurnModule } from './modules/turn/turn.module';
import { UsersModule } from './modules/users/users.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { MetricsModule } from './observability/metrics.module';
import { buildRedisOptions, RedisModule } from './redis/redis.module';

/**
 * Root application module wiring all shared infrastructure:
 * - {@link ConfigModule} (global) loading the monorepo-root `.env`,
 * - {@link LoggerModule} (nestjs-pino) as the app logger,
 * - {@link MongooseModule} connected from `MONGODB_URI`,
 * - {@link RedisModule} (global) exposing the shared ioredis client,
 * - {@link BullModule} root sharing the Redis connection settings,
 * - {@link CommonModule} providing JWT auth scaffolding, and
 * - {@link HealthModule}.
 *
 * Feature modules add themselves under `src/modules/<name>/` and the integrator
 * registers them in the `imports` array at the marked location below.
 */
@Module({
  imports: [
    // ── Error tracking (Sentry) — OPTIONAL, registered only when enabled ───
    // `SentryModule.forRoot()` installs a global tracing interceptor (HTTP
    // transaction naming) and request isolation. It is added ONLY when a
    // `SENTRY_DSN` was present at boot (see `instrument.ts#sentryEnabled`), so
    // with Sentry off this is a true no-op — no interceptor, no overhead. The
    // actual error capture is wired via `@SentryExceptionCaptured()` on the
    // existing `AllExceptionsFilter` (so we do NOT register `SentryGlobalFilter`).
    ...(sentryEnabled ? [SentryModule.forRoot()] : []),

    // ── Configuration ────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      // Load the single monorepo-root .env. Candidates cover running from the
      // repo root (turbo) or from apps/api (pnpm --filter / nest start).
      envFilePath: ['.env', '../.env', '../../.env'],
      cache: true,
    }),

    // ── Structured logging (pino) ────────────────────────────────────────
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('NODE_ENV') === 'production';
        return {
          pinoHttp: {
            level: isProd ? 'info' : 'debug',
            // Pretty, human-readable logs in dev; raw JSON in production.
            transport: isProd ? undefined : { target: 'pino-pretty' },
            // Avoid logging secrets (auth headers / cookies) verbatim.
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            autoLogging: true,
          },
        };
      },
    }),

    // ── MongoDB (Mongoose 9) ─────────────────────────────────────────────
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>(
          'MONGODB_URI',
          'mongodb://localhost:27017/ruletka?directConnection=true&retryWrites=false',
        ),
        // Fail fast if no primary is selectable, instead of hanging bootstrap.
        serverSelectionTimeoutMS: 8000,
      }),
    }),

    // ── Redis (shared client) ────────────────────────────────────────────
    RedisModule,

    // ── BullMQ (background jobs) ─────────────────────────────────────────
    // Uses a DEDICATED connection (built from the same env) — BullMQ requires
    // its own blocking connection, separate from the request-path client.
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          ...buildRedisOptions(config),
          // BullMQ mandates `maxRetriesPerRequest: null` on its connection.
          maxRetriesPerRequest: null,
        },
      }),
    }),

    // ── Cross-cutting concerns (JWT auth scaffold, etc.) ─────────────────
    CommonModule,

    // ── Transactional email (SMTP via nodemailer; dev/CI no-op default) ──
    // `@Global`, so any feature module (auth) injects `MailerService` without
    // re-importing. Sends are best-effort and never throw with no SMTP config.
    MailModule,

    // ── Rate limiting (Redis-backed, named throttlers) ───────────────────
    // Provides the `default` (global per-IP) and `auth` (strict) throttlers
    // backed by the shared ioredis client so limits hold across instances. The
    // APP_GUARD below activates the `default` throttler on every route; the auth
    // controller opts credential routes into the strict `auth` throttler via
    // `@Throttle({ auth: { … } })`.
    ThrottlerModule,

    // ── Health probe ─────────────────────────────────────────────────────
    HealthModule,

    // ── Prometheus metrics (always on; exposes GET /<prefix>/metrics) ──────
    // `@Global`, so feature modules inject `MetricsService` without re-importing.
    // Independent of Sentry — metrics emit whether or not error tracking is on.
    MetricsModule,

    // ── Feature modules ──────────────────────────────────────────────────
    // Every `@Module` class authored under `src/modules/<name>/` is registered
    // here. The cross-module import graph is a DAG (no cycles → no
    // `forwardRef()` needed):
    //
    //   auth        → users, profiles
    //   friends     → profiles, presence
    //   chat        → friends, moderation
    //   gifts       → wallet, premium
    //   covers      → wallet, profiles
    //   top         → wallet
    //   payments    → wallet, premium
    //   matchmaking → profiles, moderation, premium
    //   (users, profiles, settings, presence, moderation, wallet, premium,
    //    turn are leaf modules)
    //
    // Each owning module registers its Mongoose schema(s) via `forFeature`
    // exactly once and re-exports `MongooseModule`, so consumers (e.g. auth
    // reading `Profile`) import the owner rather than re-registering — this
    // prevents `OverwriteModelError`. Cross-module service tokens
    // (PROFILES_SERVICE / BLOCKS_SERVICE / PREMIUM_SERVICE / WALLET_SERVICE /
    // COIN_PACKAGES_SERVICE) are bound `useExisting` inside the consuming
    // modules (matchmaking, payments).

    // Identity / profile
    UsersModule,
    ProfilesModule,
    AuthModule,
    SettingsModule,

    // Social / realtime presence + chat
    PresenceModule,
    NotificationsModule,
    FriendsModule,
    ModerationModule,
    ChatModule,

    // Economy
    WalletModule,
    GiftsModule,
    CoversModule,
    TopModule,
    PremiumModule,
    PaymentsModule,
    LeaderboardModule,

    // Matchmaking + WebRTC
    MatchmakingModule,
    TurnModule,

    // Admin panel (expanded surface) — reuses the moderation staff guard; reads
    // existing collections by name; wires Wallet/Premium/Notifications for the
    // privileged actions. Pre-existing admin endpoints stay in ModerationModule.
    AdminModule,
  ],
  providers: [
    // Activate rate limiting globally. `ThrottlerBehindProxyGuard` extends the
    // stock `ThrottlerGuard` to track the real client IP from `X-Forwarded-For`
    // (requires `app.set('trust proxy', 1)` in main.ts). Routes can opt out with
    // `@SkipThrottle()` or switch to the strict `auth` limiter with `@Throttle`.
    { provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard },
  ],
})
export class AppModule {}
