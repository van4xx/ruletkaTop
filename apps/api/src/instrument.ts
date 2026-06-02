/**
 * Sentry instrumentation — MUST be the FIRST import in `main.ts`, before any
 * other module that Sentry needs to auto-instrument (NestJS, Mongoose, ioredis,
 * http, …). Importing it executes `Sentry.init()` as a side effect.
 *
 * FULLY OPTIONAL / no-op by default: with no `SENTRY_DSN` set we skip `init()`
 * entirely, so dev + CI stay green and the process boots normally. Nothing here
 * throws — a misconfigured/blank DSN must never take the API down.
 *
 * NOTE: this file runs BEFORE NestJS `ConfigModule` loads the `.env`, so it
 * reads `process.env` directly. The integrator must ensure the environment is
 * populated before `node dist/main` (the monorepo-root `.env` is exported by
 * the process manager / container; for `nest start` dotenv-style preloading or
 * an exported shell env is needed — see the summary).
 */
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
  // Profiling is an OPTIONAL extra dep (`@sentry/profiling-node`). Load it
  // defensively so the API still boots (with tracing but no profiling) if it
  // was not installed. A failed require is swallowed — never fatal.
  // Sentry v10 no longer re-exports the `Integration` type from @sentry/nestjs
  // (and @sentry/core isn't a direct dep under pnpm's strict layout) — the array
  // is structurally an Integration[] and is accepted by Sentry.init() as-is.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const integrations: any[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { nodeProfilingIntegration } = require('@sentry/profiling-node') as {
      nodeProfilingIntegration: () => unknown;
    };
    integrations.push(nodeProfilingIntegration());
  } catch {
    // @sentry/profiling-node not installed → continue without CPU profiling.
  }

  // Sample rates come from env with safe production defaults (10%). Parsed
  // defensively so a non-numeric value falls back rather than disabling tracing.
  const tracesSampleRate = parseRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.1);
  const profilesSampleRate = parseRate(process.env.SENTRY_PROFILES_SAMPLE_RATE, 0.1);

  Sentry.init({
    dsn,
    // Environment label: prefer SENTRY_ENV, then SENTRY_ENVIRONMENT (the name the
    // web app already uses in the shared root .env), then NODE_ENV, else 'development'.
    environment:
      process.env.SENTRY_ENV ??
      process.env.SENTRY_ENVIRONMENT ??
      process.env.NODE_ENV ??
      'development',
    // Optional release tag for source-map / regression tracking if provided.
    release: process.env.SENTRY_RELEASE || undefined,
    integrations,
    // Performance tracing (distributed traces across HTTP / DB / Redis spans).
    tracesSampleRate,
    // CPU profiling sampling — only meaningful if profiling-node loaded above.
    profilesSampleRate,
  });
}

/**
 * Parse a `[0,1]` sample-rate env var with a fallback. Out-of-range / NaN
 * values fall back to `fallback` so a typo can't silently disable (rate 0) or
 * over-sample (rate >1) telemetry.
 */
function parseRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return fallback;
  }
  return value;
}

/**
 * Whether Sentry was initialised this process. Exported so `main.ts` /
 * `app.module.ts` can branch (e.g. only register the SentryModule / log a
 * one-liner) without re-reading the env or re-implementing the DSN check.
 */
export const sentryEnabled = Boolean(dsn);
