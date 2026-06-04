// ⚠️ Sentry instrumentation MUST load before everything else so it can patch
// NestJS / Mongoose / ioredis / http at require time. No-op without SENTRY_DSN.
import './instrument';

import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { validateCriticalConfig } from './common/config-validation';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

/**
 * Public, unauthenticated catalogue GETs that are safe to cache at the edge /
 * in the browser. These return slow-moving reference data (storefront pricing,
 * gift catalogue, the public top feed) and carry NO per-user payload, so a
 * short shared cache cuts repeat round-trips without leaking anything.
 *
 * Matching is anchored to the full path AFTER the global prefix (e.g.
 * `/api/coin-packages`) and is exact per-entry, so authenticated siblings like
 * `/wallet` or `/wallet/transactions` are never matched. `/top` matches only
 * the feed root, never a future `/top/...` subpath.
 */
const PUBLIC_CACHEABLE_GETS: ReadonlyArray<{ path: string; cacheControl: string }> = [
  // Coin packages change rarely; allow a short shared cache + SWR window.
  {
    path: 'coin-packages',
    cacheControl: 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  },
  // Gift catalogue is effectively static within a deploy.
  { path: 'gifts', cacheControl: 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' },
  // Premium plans (pricing) — same cadence as the rest of the storefront.
  {
    path: 'premium/plans',
    cacheControl: 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  },
  // The public top feed is paid + time-boxed: keep it fresh, but a brief shared
  // cache absorbs bursts (it is fetched on the landing + dashboard).
  { path: 'top', cacheControl: 'public, max-age=15, s-maxage=30, stale-while-revalidate=60' },
];

/**
 * Application entrypoint. Boots the Nest app with production-grade defaults:
 * security headers (helmet), credentialed CORS from `CORS_ORIGINS`, global Zod-
 * friendly validation, a global prefix, structured pino logging, Swagger docs,
 * the Redis-backed Socket.io adapter (horizontal scaling) and graceful
 * shutdown.
 */
async function bootstrap(): Promise<void> {
  // `bufferLogs` defers logging until the pino logger is wired, so even startup
  // logs go through it instead of Nest's built-in console logger.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Expose the raw request buffer as `req.rawBody` so the CloudPayments
    // webhook can HMAC-verify the EXACT bytes the provider signed
    // (CloudPaymentsSignatureGuard reads `req.rawBody`). Harmless for all other
    // routes; required once the payments webhook controller is registered.
    rawBody: true,
  });

  // Route ALL framework logs through nestjs-pino.
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const logger = app.get(Logger);
  const isProd = config.get<string>('NODE_ENV') === 'production';

  // ── Critical-secrets boot guard (FAIL-FAST in production) ──────────────
  // Before wiring any network resource or accepting a request, assert the
  // critical secrets (JWT access + refresh) are present and not a shipped
  // placeholder when NODE_ENV=production; throwing here aborts bootstrap. Also
  // WARNs (non-fatal) for unconfigured optional integrations (CloudPayments,
  // TURN, SMTP, VAPID). No-op enforcement in dev/test. Never logs secret values.
  validateCriticalConfig(config, logger);

  // ── Trust the reverse proxy (1 hop) ────────────────────────────────────
  // Behind a load balancer / ingress, Express must trust the first proxy so
  // `req.ip` / `req.ips` reflect the real client (from `X-Forwarded-For`) and
  // `req.protocol` reflects the external scheme. The rate-limit guard
  // (ThrottlerBehindProxyGuard) and the Secure-cookie decision both rely on this.
  app.set('trust proxy', 1);

  // ── Cookie parsing (must run BEFORE routes) ────────────────────────────
  // Populates `req.cookies` so AuthController can read the httpOnly refresh
  // cookie (`ruletka_rt`) on /auth/refresh and /auth/logout.
  app.use(cookieParser());

  // ── HTTP response compression (gzip/deflate/br) ─────────────────────────
  // Shrinks JSON payloads on the wire (catalogues, feeds, profiles) for a large
  // first-byte→first-paint win on slow links. Loaded defensively so the API
  // still boots if the dependency has not been installed yet (the integrator
  // installs `compression` + `@types/compression`); a one-line warning makes a
  // missing dep obvious without taking the process down.
  //
  // SECURITY: compression only runs on responses the client opted into via
  // `Accept-Encoding`. It does not touch the TLS-terminated request body, the
  // raw webhook buffer (`rawBody`), or any Set-Cookie header, so it cannot
  // weaken the cookie/HMAC hardening. `threshold` skips tiny bodies where
  // framing overhead would outweigh the win.
  type CompressionFilter = (req: Request, res: Response) => boolean;
  type CompressionFactory = ((options?: Record<string, unknown>) => RequestHandler) & {
    filter: CompressionFilter;
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const compression = require('compression') as CompressionFactory;
    app.use(
      compression({
        // Skip compressing responses below ~1KB (negligible gain, adds CPU).
        threshold: 1024,
        // Honour an explicit opt-out from a caller via `x-no-compression`,
        // otherwise defer to compression's default content-type heuristics.
        filter: (req: Request, res: Response) =>
          req.headers['x-no-compression'] ? false : compression.filter(req, res),
      }),
    );
  } catch {
    logger.warn(
      "Response compression is disabled: the 'compression' package is not installed. " +
        'Run `pnpm add compression && pnpm add -D @types/compression` in apps/api to enable it.',
      'Bootstrap',
    );
  }

  // ── Security headers (helmet) ──────────────────────────────────────────
  // Explicit Content-Security-Policy + HSTS on top of helmet's sane defaults.
  // The API serves JSON (and, in non-prod, the Swagger UI), so the CSP is
  // deliberately tight: no third-party script/style origins beyond what
  // swagger-ui needs. `connectSrc` stays 'self' — browsers calling the API
  // cross-origin are governed by CORS below, not this CSP.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: [`'self'`],
          baseUri: [`'self'`],
          frameAncestors: [`'none'`],
          objectSrc: [`'none'`],
          // swagger-ui injects inline styles and an inline init script.
          scriptSrc: [`'self'`, `'unsafe-inline'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, 'data:'],
          connectSrc: [`'self'`],
          upgradeInsecureRequests: isProd ? [] : null,
        },
      },
      // 180 days HSTS, include subdomains, and allow preload-list submission.
      hsts: {
        maxAge: 15_552_000,
        includeSubDomains: true,
        preload: true,
      },
      // The API is not framed; deny to harden against clickjacking.
      frameguard: { action: 'deny' },
      // Hide the default `X-Powered-By: Express` fingerprint.
      hidePoweredBy: true,
      // Let cross-origin clients (the web app on another origin) read responses;
      // access is still gated by the CORS policy below.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // ── CORS (credentialed, origins from env; FAIL-CLOSED in production) ────
  // `credentials: true` means the browser sends cookies, so we must NEVER pair
  // it with a reflect-any-origin policy. Dev convenience (reflect any origin)
  // is allowed only outside production; in production an empty CORS_ORIGINS
  // disables cross-origin access entirely rather than silently allowing all.
  const corsOrigins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  } else if (isProd) {
    // Fail closed: no allow-listed origins → no cross-origin credentials.
    logger.warn(
      'CORS_ORIGINS is empty in production; cross-origin requests are disabled. ' +
        'Set CORS_ORIGINS to the web app origin(s) to enable the browser client.',
      'Bootstrap',
    );
    app.enableCors({ origin: false, credentials: true });
  } else {
    // Dev only: reflect the request origin so localhost ports work freely.
    app.enableCors({ origin: true, credentials: true });
  }

  // ── Global validation ──────────────────────────────────────────────────
  // class-validator-based pipe for any DTO using decorators; Zod schemas from
  // shared-types are validated per-route via the dedicated ZodValidationPipe.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Uniform error responses (ApiError shape) ───────────────────────────
  app.useGlobalFilters(new AllExceptionsFilter());

  // ── API surface conventions ────────────────────────────────────────────
  const globalPrefix = config.get<string>('API_GLOBAL_PREFIX', 'api');
  app.setGlobalPrefix(globalPrefix);

  // ── Cache-Control for public catalogue GETs ─────────────────────────────
  // A thin, allow-listed middleware that stamps `Cache-Control` on the handful
  // of unauthenticated reference endpoints (see `PUBLIC_CACHEABLE_GETS`). It is
  // FAIL-SAFE by construction: it only ever ADDS caching to exact-match GETs on
  // the public list and explicitly marks everything else `no-store`, so an
  // authenticated/personalised response can never be cached by a proxy even if
  // a future route shadows a public path. Runs before routing; the matched
  // handler may still override its own header if needed.
  const prefix = globalPrefix.replace(/^\/+|\/+$/g, '');
  const cacheablePaths = new Map<string, string>(
    PUBLIC_CACHEABLE_GETS.map((entry) => [`/${prefix}/${entry.path}`, entry.cacheControl]),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      // `req.path` excludes the query string, so `?cursor=` variants don't leak
      // past the exact match (the cacheable list has no query-bearing routes).
      const directive = cacheablePaths.get(req.path);
      if (directive) {
        res.setHeader('Cache-Control', directive);
        // Vary on encoding so a compressed/uncompressed pair never crosses caches.
        res.setHeader('Vary', 'Accept-Encoding');
        return next();
      }
    }
    // Default to private/no-store everywhere else: authenticated JSON must not
    // be retained by intermediaries. (Harmless on the already-public reads above
    // because they short-circuit via the early return.)
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // ── Graceful shutdown (lets RedisModule / adapter close connections) ────
  app.enableShutdownHooks();

  // ── Socket.io horizontal scaling via Redis ──────────────────────────────
  const redisIoAdapter = new RedisIoAdapter(app, config);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // ── Swagger / OpenAPI at `${prefix}/docs` — NON-PRODUCTION ONLY ─────────
  // The docs expose the full API surface and an interactive client, so they are
  // gated off in production. Re-enable behind authentication (e.g. basic-auth
  // middleware on `${prefix}/docs`) if internal prod docs are ever needed.
  const swaggerEnabled = !isProd;
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ruletka.top API')
      .setDescription('Video/voice roulette platform — REST + realtime backend')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${globalPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // ── Listen ───────────────────────────────────────────────────────────────
  const port = config.get<number>('API_PORT', 4000);
  const host = config.get<string>('API_HOST', '0.0.0.0');
  await app.listen(port, host);

  logger.log(`API listening on http://${host}:${port}/${globalPrefix}`, 'Bootstrap');
  if (swaggerEnabled) {
    logger.log(`Swagger docs at http://${host}:${port}/${globalPrefix}/docs`, 'Bootstrap');
  }
}

void bootstrap();
